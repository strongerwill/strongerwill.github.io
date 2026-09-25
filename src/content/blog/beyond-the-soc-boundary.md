---
title: "Beyond the SoC Boundary: Confidential VM Guarantees in the Presence of Untrusted CXL Memory Controllers"
description: "CXL Type 3 expanders put firmware on the path CVM integrity assumes is passive. Compromised data-path firmware can replay, drop, corrupt, or alias ciphertext without physical access."
pubDate: 2026-09-24
topics:
  - security
  - innovation
draft: false
---

Confidential virtual machines (CVMs) such as AMD SEV-SNP and Intel TDX protect guest memory with two mechanisms that are enforced inside the processor package: deterministic memory encryption (AES-XTS keyed per guest and tweaked by physical address) for confidentiality, and an ownership table (for example SEV-SNP's Reverse Map Table, RMP) checked by the CPU and the IOMMU for integrity. Both mechanisms implicitly assume that whatever sits behind the memory controller faithfully stores and returns the ciphertext it is given.

Compute Express Link (CXL) breaks this assumption: a CXL Type 3 memory expander places a programmable controller, running its own firmware, between the SoC and the DRAM that backs host physical memory. The relevant adversary is not a physical attacker with an interposer, but **a compromise of the data-path portion of the controller firmware**, which may be reachable from host software through standard management interfaces. Such an adversary obtains, without physical access, the same primitives recently shown to break SEV-SNP attestation with DRAM interposers: ciphertext replay, write dropping, corruption, and dynamic address aliasing, together with a complete view of the guest's memory access pattern and ciphertext evolution.

This post systematizes the guarantees that remain for each CXL protocol (CXL.io, CXL.cache, CXL.mem), explains why link protection (CXL IDE) and device attestation (CXL TSP) do not close the gap, enumerates the firmware attack surface, and outlines design directions — ranging from attestable placement policies to a host-side freshness scheme that anchors versions in RMP-protected local DRAM and does not trust the device.

## Introduction

Confidential computing moves the hypervisor, host operating system, and cloud operator out of the trusted computing base (TCB) of a virtual machine. On current x86 server platforms this is achieved by a small set of mechanisms located inside the SoC: a memory encryption engine in the memory controller that encrypts every cache line leaving the package, an access-control structure that records which guest owns each physical page, and a secure processor or trusted module that manages keys and produces attestation reports (AMD SEV-SNP; Intel TDX).

Scaling encryption to hundreds of gigabytes per second forced vendors to use deterministic, address-tweaked encryption without freshness protection. Integrity against a malicious hypervisor is instead provided *architecturally*: SEV-SNP's RMP ensures that software other than the owning guest cannot write a guest-private page, and the same check is applied by the IOMMU to device DMA. This design is sound as long as the only path to guest memory is through the SoC. Physical attacks on DRAM are explicitly out of scope of the SEV-SNP threat model, and recent work has shown what happens when that assumption is violated: BadRAM and Battering RAM create physical address aliases, via a manipulated SPD chip or a low-cost DDR4 interposer, and use ciphertext replay to break SEV-SNP attestation.

CXL changes the physical picture. A CXL Type 3 memory expander exposes host-managed device memory (HDM) that the host maps into its physical address space and may use as ordinary system memory. The DRAM behind this address range is controlled not by the SoC's memory controller but by a controller ASIC on the device, which decodes addresses, schedules DRAM commands, performs RAS functions, and runs firmware that also serves management commands. In other words, CXL inserts a programmable, firmware-driven component on exactly the path that the CVM threat model assumes to be passive.

**Observation.** An adversary does not need malicious hardware, nor a compromise of the controller's most privileged firmware, to attack guest memory stored on CXL. It is sufficient to control the logic that handles memory reads and writes. That logic can, at runtime and without any physical access, return stale ciphertext for an address (replay), silently discard writes, corrupt data, or redirect one host physical address to the media backing another (aliasing). Because AES-XTS is deterministic and has no freshness, and because the RMP only governs accesses that originate inside the SoC, none of these manipulations are detected by current CVM hardware.

This is a systematization and position paper. It:

- defines a *compromised data-path firmware* adversary for CXL memory and argues that it is more practical in several respects than the physical adversaries considered in prior work;
- analyzes, per CXL protocol, which CVM guarantees survive such an adversary;
- describes the resulting attack primitives and relates them to published DRAM aliasing attacks;
- enumerates the firmware attack surface through which a malicious host or operator can reach the data path;
- explains why CXL IDE, CXL TSP, and boot-time alias checks do not fully address the problem; and
- proposes design directions, including a host-side freshness scheme that stores versions in RMP-protected local DRAM and does not trust the device.

## Background

### Memory protection in confidential VMs

**Confidentiality.** SEV-SNP and TDX encrypt guest-private memory in the memory controller with a per-guest (SEV) or per-trust-domain (TDX) key using AES in XTS mode or an XEX-style variant. The tweak is derived from the physical address, so identical plaintext at different addresses produces different ciphertext, but identical plaintext written to the *same* address always produces identical ciphertext. This determinism is the root of ciphertext side channels.

**Integrity in SEV-SNP.** SEV-SNP introduces the Reverse Map Table, a system-wide structure with one entry per 4 KiB physical page recording its owner (hypervisor, a specific guest identified by ASID, or firmware), its guest physical address, and a *Validated* bit. The CPU checks the RMP during address translation, and the IOMMU performs the same check on device DMA, so that hypervisor software and devices cannot write guest-assigned pages. The hypervisor modifies the RMP only through dedicated instructions (e.g., `RMPUPDATE`); reassigning a page clears its Validated bit, which the guest detects via a #VC exception on next access. The integrity guarantee is thus access control, not cryptography: *if the guest can read a private page, it reads the last value it wrote*, under the assumption that DRAM stores what the memory controller sends it.

**Intel TDX.** TDX uses multi-key total memory encryption with private KeyIDs, tracks page ownership in the Physical Address Metadata Table managed by the TDX module, and optionally supports per-line integrity modes that detect some forms of tampering but do not provide replay protection.

### Device I/O in confidential VMs

By default, devices are outside the TCB. Devices can DMA only into *shared* (hypervisor-owned, unencrypted) pages; DMA writes to guest-private pages are blocked by the RMP check in the IOMMU, and DMA reads of private pages return ciphertext. Guests therefore use bounce buffers (e.g., Linux `swiotlb`) and must treat all I/O data as untrusted.

To allow trusted devices direct access to private memory, the PCIe ecosystem defines DMTF SPDM for device authentication and measurement, Integrity and Data Encryption (IDE) for link protection, and the TEE Device Interface Security Protocol (TDISP) for binding a device interface to a TEE; vendor realizations include AMD SEV-TIO and Intel TDX Connect.

### Compute Express Link

CXL multiplexes three protocols over the PCIe physical layer:

- **CXL.io**: PCIe-equivalent semantics for discovery, configuration, mailbox commands, and DMA.
- **CXL.cache**: allows a device to coherently cache host memory; device requests are serviced by the host's coherence agents.
- **CXL.mem**: allows the host to issue load/store requests to device-attached memory (HDM). A Type 3 device (memory expander) implements CXL.io and CXL.mem only.

CXL 2.0 added IDE for CXL.cache/CXL.mem, providing confidentiality, integrity, and replay protection for flits *on the link*. CXL 3.1 introduced the TEE Security Protocol (TSP), which defines how directly attached CXL memory devices can be brought into a TEE VM's trust boundary through SPDM-based attestation, device-side memory encryption, access control, and configuration locking.

## Threat model

We consider a CVM on a platform where some or all of the guest's private memory is backed by a CXL Type 3 device, either directly attached or behind a CXL switch.

**Trusted.** The SoC hardware (cores, memory controller, encryption engine, IOMMU), the secure processor and its firmware, and the guest's own software.

**Adversary.** The adversary controls the hypervisor and host OS, as in the standard CVM model, and additionally controls the *data-path firmware* of the CXL memory controller — the code (or configurable logic) that services CXL.mem read and write requests, including address decoding, request scheduling, and error handling. We do *not* assume:

- physical access to the server, DIMMs, or the CXL link;
- malicious or modified controller silicon;
- compromise of the controller's root of trust, secure boot, or attestation keys.

Data-path control may be obtained by exploiting a vulnerability reachable from host software, through a malicious or vulnerable firmware update, through a supply-chain compromise, or by an insider at the device vendor or operator.

**Why this adversary matters.** Physical adversaries are excluded from SEV-SNP's threat model largely because physical access to data-center servers is assumed to be difficult and detectable. This adversary achieves an equivalent position in the memory path *remotely and persistently*, and scales across every server with the same device model. It also sidesteps the argument that interposers are exotic: the "interposer" is a standard, vendor-supplied component whose behavior is defined by software.

**Out of scope.** Denial of service (the device can always refuse to serve memory), microarchitectural side channels inside the SoC, and attacks on the secure processor itself.

## Guarantee analysis per CXL protocol

The RMP and IOMMU checks govern accesses that originate inside the SoC. For CXL.mem, ciphertext leaves the SoC and is stored by a firmware-driven controller that neither mechanism constrains.

**CXL.io.** CXL.io has PCIe semantics. Device-initiated DMA passes through the IOMMU and is subject to the RMP check exactly as for any PCIe device. A compromised CXL device acting over CXL.io is therefore no more powerful than a malicious PCIe device against a CVM using bounce buffers.

**CXL.cache.** A device using CXL.cache issues coherent requests that are serviced by the host's home agents. Such requests enter the SoC and can in principle be checked. However, interactions with Address Translation Services, translated requests, and caching of host lines on the device make the precise enforcement point platform-specific. Treat CXL.cache devices as analogous to PCIe devices with ATS, which already require care in TEE-IO designs.

**CXL.mem.** Here the situation is fundamentally different. The host issues loads and stores to HDM; the device controller stores the data in its own DRAM. For guest-private memory placed in HDM:

- *Confidentiality holds* with respect to the device, provided the SoC encrypts HDM-bound private traffic with the guest key, because the controller only ever sees AES-XTS ciphertext.
- *Integrity and freshness do not hold.* The RMP guarantees that no *SoC-side* agent other than the owning guest writes the page. It says nothing about whether the media returns the most recently written ciphertext. The controller can return any ciphertext it has previously observed for that address, and AES-XTS will decrypt it without error.
- *Access pattern privacy does not hold.* The controller observes every address, every read and write, and, because encryption is deterministic, whether each written value differs from the previous one at that address.

The RMP itself must likewise never reside in HDM.

| Private memory location / adversary | Conf. | Integrity | Freshness |
| --- | --- | --- | --- |
| Local DRAM, malicious hypervisor | yes | yes (by design) | yes (by design) |
| Local DRAM, physical interposer | yes (direct) | no | no |
| CXL HDM, no TSP, compromised data path | yes | no | no |
| CXL HDM, TSP, honest device | yes | yes (if implemented correctly) | yes |
| CXL HDM, TSP, data path compromised after attestation | yes (SoC-side layer only) | no | no |

## Attack primitives

A compromised data path obtains the following primitives against guest-private lines stored in HDM. All operate at runtime and are invisible to the SoC.

**P1: Same-address replay.** Record the ciphertext of a line at time t0 and return it for reads after a later write at t1. The guest decrypts a stale but authentic-looking plaintext. Targets include counters, sequence numbers, lock and reference-count words, page-table-like guest structures, key material that has been rotated, and security-relevant flags.

**P2: Write dropping.** Acknowledge a write without committing it. This is equivalent to replaying the prior value and requires no storage by the adversary. CacheWarp showed that reverting individual guest stores in SEV-SNP, there via cache invalidation, suffices to recover RSA keys through fault injection, bypass OpenSSH authentication, and escalate privileges via `sudo`. A compromised controller obtains the same capability at the memory side, with no dependence on a CPU instruction that can be patched in microcode.

**P3: Corruption.** Modify stored ciphertext. Because of XTS diffusion, flipping any bit randomizes the entire 16-byte block after decryption. The adversary does not control the resulting plaintext, but uncontrolled corruption of pointers, lengths, or booleans is frequently exploitable, and corruption can be restricted to chosen 16-byte blocks.

**P4: Dynamic aliasing.** The controller's address decoder can be made to map two host physical addresses to the same media location, or to swap the backing of two addresses, at a time of the adversary's choosing. This reproduces the mechanism of BadRAM and, more importantly, the *runtime* aliasing of Battering RAM, which evades boot-time alias checks. Published end-to-end attacks show that aliasing plus replay is sufficient to break SEV-SNP attestation. Relocating ciphertext across addresses yields garbage because of the address tweak; the dangerous case is replay *at the same address* or aliasing that lets the adversary capture and later restore a line's ciphertext.

**P5: Access-pattern and ciphertext observation.** Independent of integrity, the controller observes a precise, noiseless trace of addresses and ciphertext changes. Deterministic encryption enables the ciphertext side channels demonstrated against SEV. Mitigations that prevent *host software* from reading guest ciphertext do not apply to the component storing the ciphertext.

**Targeting.** The controller sees host physical addresses only. The untrusted hypervisor, however, knows the mapping from guest-physical to host-physical pages and can communicate it to the device, for example through a vendor-specific mailbox command, so the two adversaries can cooperate to aim P1–P4 at specific guest structures.

**Comparison with physical attacks.** P1–P5 are a superset of what DRAM interposers provide, with three practical advantages: no physical access, persistence across reboots if firmware is modified, and the ability to act selectively on specific addresses with full knowledge of the request stream.

## Firmware attack surface

The adversary needs control of the data path, not of the whole device. Entry points include:

- **Host mailbox commands.** CXL memory devices expose a command interface over CXL.io (identification, health, poison management, firmware update, event logs, vendor-specific commands). The hypervisor, which is untrusted in the CVM model, can issue these commands. Any parsing or state-machine vulnerability in their handling is a host-to-device escalation path.
- **Sideband management.** Baseboard management controllers can reach devices over SMBus/I²C or MCTP. BMCs are themselves a frequent target and are controlled by the operator.
- **Firmware update.** Signed update schemes protect against arbitrary images, but not against vulnerable signed images, rollback where anti-rollback is absent, or a compromised signing pipeline.
- **Fabric management.** In switched and pooled deployments, a Fabric Manager configures switches and device resources (including dynamic capacity). Switch firmware and the Fabric Manager join the path between host and media.
- **RAS and error handling.** Patrol scrub, poison handling, and sparing legitimately rewrite or remap media, providing natural cover for P1–P4.

In controller designs where data-path management, RAS, and command handling share processors or firmware images, a bug in a management handler can yield data-path control.

## Why existing mechanisms fall short

| Mechanism | P1 Replay | P2 Drop | P3 Corrupt | P4 Alias |
| --- | --- | --- | --- | --- |
| RMP / PAMT ownership checks | no | no | no | no |
| AES-XTS (address-tweaked) | no | no | no (uncontrollable at 16B) | no |
| Per-line MAC, no version, MAC stored on device | no | no | yes | partial (cross-address only) |
| CXL IDE (link) | no | no | no | no |
| CXL TSP, device honest | yes (if implemented) | yes | yes | yes |
| CXL TSP, data path compromised | no | no | no | no |
| Boot-time alias checks | no | no | no | static only |
| MAC + version + tree, root on SoC | yes | yes | yes | yes |

### Ownership tables protect addresses, not contents

The RMP (and, analogously, TDX's PAMT) answers the question *which agent may access this physical page?* Its guarantee is enforced at translation time, inside the SoC, on the requester side of the memory system. Informally, SEV-SNP's integrity property is that a guest reading a private page observes its own last write; the RMP establishes this by ensuring that no other SoC-side agent writes the page, and relies on an implicit axiom that *memory returns what was last written to it*. For local DRAM the axiom is reasonable against software adversaries. For HDM it is precisely what the adversary violates.

Two further details reinforce the point. First, the Validated bit and the `PVALIDATE` protocol detect changes to the page-to-owner *mapping*, not changes to page *contents*; a controller that replays ciphertext never touches the RMP, so the guest receives no #VC. Second, the RMP itself is stored in memory. If any part of it were placed in HDM, the adversary could replay RMP entries and recreate the remapping attacks (e.g., SEVered) that SNP was designed to eliminate. The secure processor must therefore ensure that the RMP resides exclusively in local DRAM.

### Deterministic encryption without freshness

AES-XTS with an address tweak provides confidentiality against a passive observer and makes cross-address relocation produce garbage. It provides no integrity: any modification decrypts without error to pseudorandom plaintext. Adding a per-line MAC is not sufficient on its own. If the MAC is computed over ciphertext and address but not over a version, and the MAC is stored alongside the data on the same device, then the adversary can replay the (ciphertext, MAC) pair together. Freshness requires a version that the adversary cannot roll back.

The reason current CVMs lack freshness is performance: integrity trees over hundreds of gigabytes impose additional memory accesses on every miss. Battering RAM makes the same observation for DRAM interposers; the contribution here is that CXL makes the absence of freshness exploitable without physical access.

### Link protection terminates at the adversary

CXL IDE provides confidentiality, integrity, and replay protection for flits between two IDE endpoints, using AES-GCM with keys established over SPDM. Its adversary is an entity *on the link*: a retimer, switch, or interposer between host port and device port. The device's IDE endpoint, however, is part of the controller. Once a flit has been verified and decrypted by that endpoint, the controller holds the payload and is free to store, discard, duplicate, or modify it. When it later responds to a read, it produces a fresh, correctly authenticated IDE flit containing whatever payload it chose. IDE's replay protection is replay protection *of link traffic*, not of stored data.

### Device attestation moves trust instead of removing it

CXL TSP, and TDISP for PCIe devices, allow a TEE to authenticate a device via SPDM, obtain measurements of its firmware and configuration, lock that configuration, and then admit the device into the TEE's trust boundary. Against this adversary it has five limitations:

- **TCB expansion.** Admitting the device places its entire firmware, including mailbox handlers, RAS logic, and vendor-specific commands, into the CVM's TCB.
- **Point-in-time evidence.** SPDM measurements describe what was loaded, not what is currently executing. A runtime compromise does not change the measured image.
- **Self-reported state transitions.** The component that must detect and report a violation after lock is the component assumed compromised.
- **Keys in the device.** Any device-side encryption key is available to the adversary controlling the data path. Host-side AES-XTS remains the only layer the adversary cannot strip, and it provides no freshness.
- **Firmware update and rollback.** A vulnerable but correctly signed image is indistinguishable from a benign one in attestation.

### Boot-time validation cannot bind runtime behavior

Boot-time alias checks establish that the memory map is consistent *at the time of the check*. A CXL controller is in a strictly stronger position than an interposer: its address decoding is implemented in firmware or firmware-configured logic, it can observe when the host has finished validation, and it can change the mapping for individual addresses at any later time.

### Placement is controlled by the untrusted hypervisor

Even if a guest owner decides that sensitive data must not reside on CXL memory, the guest cannot enforce this. Guest-physical memory is mapped to host-physical memory by the hypervisor, and the RMP records only ownership, not the physical medium backing a page. Unless the secure processor restricts private assignments to local DRAM, or attestation exposes which private pages are backed by HDM, the guest has no means of knowing whether any of its memory is exposed to this adversary.

**Summary.** Each mechanism is sound with respect to the adversary it was designed for. None addresses an active adversary *at the memory endpoint* during runtime. The only mechanism that does is host-side freshness protection, which no current CVM platform applies to CXL memory.

## Design directions

### Goals

- **G1, host-verifiable freshness.** A read of private memory either returns the last value written by the guest or raises a detectable fault, without relying on the correctness of device firmware.
- **G2, bounded TCB.** The TCB should not grow to include device firmware, fabric managers, or switches.
- **G3, bounded overhead.** Overheads should be acceptable for CXL memory's typical role as a capacity tier.
- **G4, deployability.** Firmware or software changes are preferable in the short term.
- **G5, transparency.** Ideally, guests use CXL-backed memory as ordinary memory.

### D1: Keep private memory off HDM, and make placement attestable

The most immediate mitigation is policy. The secure processor (or TDX module) rejects transitions that would assign a page in an HDM range to a guest, so that all private memory resides in local DRAM. The guest owner should be able to verify this policy remotely through attestation.

Enforcement is subtler than it appears. HDM ranges are determined by host-side HDM decoders in the CXL host bridge, programmed by untrusted firmware and OS. The secure processor must validate and lock the host-side decoder configuration at SNP initialization. Because the decoders are SoC registers, this check remains within the trusted boundary.

D1 satisfies G1 and G2 by avoidance and requires only firmware changes. Its cost is capacity: CVMs cannot benefit from CXL memory for private data.

### D2: Host-side freshness for HDM, anchored in local DRAM

Extend the memory encryption engine on the HDM path with per-line MACs and versions, verified by the SoC on every read. The central design question is where the versions live.

- **Option A: integrity tree with an on-chip root.** Classical and complete, but expensive at tera-scale.
- **Option B: versions in a trusted smart memory device.** Efficient (Toleo), but reintroduces a trusted device.
- **Option C: versions in local DRAM, protected by ownership.** Local DRAM is trusted against this software/firmware adversary because every access passes through SoC-resident RMP checks. Versions for HDM lines can be stored in firmware-owned pages of local DRAM. MACs, which bind ciphertext, address, and version, can be stored on the untrusted device; a replayed MAC fails against the current version.

With split counters, a 64-bit major counter per 4 KiB page and a 7-bit minor counter for each of its 64 lines require 72 bytes per 4 KiB, or about 1.8% of the protected HDM capacity. Protecting 1 TiB of HDM thus consumes roughly 18 GiB of local DRAM, and only for pages that are actually private.

On a read of a private HDM line, the SoC fetches data and MAC from the device and the version from a metadata cache backed by local DRAM, then verifies the MAC before returning plaintext. Aliasing (P4) is also detected, because a line written through one address will fail MAC verification when read through the other.

Option C satisfies G1, G2, and G5 and plausibly G3 for a capacity tier, but requires new hardware in the memory encryption path. It does not weaken the existing threat model; it extends its guarantees to HDM.

### D3: Guest-managed authenticated tier

Without hardware changes, a guest can treat HDM as an explicit, authenticated tier, analogous to how CVMs treat disks. Pages evicted to HDM are encrypted with an AEAD scheme, tagged with a version, and the versions and keys are kept in private local memory. This trades transparency and performance for deployability, and is best suited to cold data.

### D4: Hardening the device when it must be trusted

When a platform chooses to admit CXL devices into the TCB via TSP: separate the data plane from the management plane in hardware; shrink the reachable mailbox surface in the locked state; measure mutable security-relevant configuration, not only images; and constrain or disallow firmware updates in the locked state. D4 improves assurance but does not meet G1 or G2.

### D5: Runtime aliasing and replay detection

The SoC or the guest can perform probabilistic checks (sentinel lines, checksums over critical structures). This raises the cost of persistent, broad manipulation but offers no guarantee against targeted attacks. Treat it as a complement to D1 or D2.

### D6: Explicit threat models and attestation claims

CVM vendors should state whether private memory on CXL devices is supported, and which trust assumptions apply. Attestation reports should expose the composition of private memory by medium. CXL TSP could define an optional mode in which the host, not the device, provides freshness.

| Direction | Freshness | TCB | New HW | Transparent |
| --- | --- | --- | --- | --- |
| D1 Private memory off HDM | yes (by avoidance) | bounded | no | yes |
| D2-A Integrity tree, on-chip root | yes | bounded | yes | yes |
| D2-B Versions in trusted smart memory | yes if device trusted | expanded | yes | yes |
| D2-C Versions in RMP-protected local DRAM | yes | bounded | yes | yes |
| D3 Guest-managed authenticated tier | yes | bounded | no | no |
| D4 Device hardening under TSP | no | expanded | device | yes |
| D5 Runtime sentinels | partial | bounded | no | yes |

**Suggested roadmap.** In the short term, platforms can adopt D1 and D6 with firmware and specification changes alone. Workloads that need large confidential memory can use D3 for cold data. In the longer term, D2-C appears to offer the best balance: it extends SEV-SNP's existing guarantees to CXL memory without trusting the device, with a metadata cost of about 2% of protected capacity.

## Open questions

This analysis does not include an end-to-end attack. A faithful demonstration requires CVM-capable hardware with CXL support and a programmable CXL device implementing P1–P4. We argue that data-path control is reachable, but do not present a concrete vulnerability in a commercial controller. The practical relevance also depends on which platforms currently permit CVM private memory in CXL HDM.

The focus is Type 3 memory expanders on x86 CVMs. Type 2 devices, multi-host memory sharing in CXL fabrics, and other CVM architectures such as Arm CCA raise related but distinct questions.

## Conclusion

CVM integrity on current x86 platforms rests on access control enforced inside the SoC and on the assumption that memory is a passive store. CXL memory expanders replace that passive store with firmware. A compromise of only the data-path portion of that firmware, potentially reachable from the untrusted host, yields replay, write dropping, corruption, and dynamic aliasing — the capabilities that recent physical attacks used to break SEV-SNP attestation.

Link protection does not help against a malicious endpoint, and device attestation moves rather than removes the trust. In the short term, CVM platforms should keep guest-private memory off CXL HDM, validate and lock host-side HDM decoders, and make memory placement visible in attestation. In the longer term, host-side freshness that stores versions in RMP-protected local DRAM appears to extend existing CVM guarantees to CXL memory at a metadata cost of about 2% of protected capacity, without admitting the device into the TCB.

*This post is a draft systematization. Selected references include AMD SEV-SNP (2020); Intel TDX (2023); BadRAM (IEEE S&P 2025); Battering RAM (IEEE S&P 2026); CacheWarp (USENIX Security 2024); CipherLeaks (USENIX Security 2021); Gueron, Memory Encryption Engine (2016); Toleo (ASPLOS 2024); CXL Specification 3.1; PCI-SIG TDISP; DMTF SPDM.*
