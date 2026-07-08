# Blackwell Project / WhatsApp Mapping Audit

Captured from user screenshots on 2026-07-08, updated with `Relacion proyectos-grupo de WA .xlsx`, and crossed against Supabase `wa_groups`.

## Supabase Updates Applied

These were high-confidence matches and were updated in `wa_groups`.

| Project | WhatsApp group | New account_id | Note |
| --- | --- | --- | --- |
| 01 TURBOFIN | Turbofin + Blackwell | 01 | Was `00_UNMAPPED`. |
| 07 APOLLO | Apollo comunicacion | 07 | Was `00_UNMAPPED`. |
| 14 DALINDE | Dalinde + Blackwell | 14 | Was `00_UNMAPPED`. |
| 26 BERNARDO V | Interno Bernardo V | 26 | Was `00_UNMAPPED`. |
| 44 LCH Luxury Travel | Interno LCH | 44 | Was `00_UNMAPPED`. |
| 44 LCH Luxury Travel | Blackwell + LCH | 44 | Was `00_UNMAPPED`. |
| 38 KARPOWERSHIP | Interno KPS | 38 | Was mapped to `40`; corrected because screenshots show `40` is AUSTRIA. |
| 38 KARPOWERSHIP | Blackwell & KPS | 38 | Was mapped to `40`; corrected because screenshots show `40` is AUSTRIA. |
| 18 STPRM | Comms Lider | 18 | Excel update places this group under STPRM; it had been mapped to `41` IFA. |
| 14 DALINDE | Comunicacion DSAI + Blackwell | 14 | Excel update places this group under Dalinde. |
| 14 DALINDE | Edicion Notas Blackwell | 14 | Excel update places this group under Dalinde. |

## Projects With WhatsApp Groups

| Project | Status | Groups |
| --- | --- | --- |
| 01 TURBOFIN | active | Turbofin + Blackwell |
| 02 MAJA | active | Interno Maja; Maja/BWS Ops; MAJA A+ Blackwell |
| 05 CREDIX | active | Credix/BWS |
| 06 RR | active | Medios RR (from Excel; not yet present in Supabase) |
| 07 APOLLO | active | Apollo comunicacion |
| 09 GRUPO AZVI | active | Interno Azvi; Azvi + Blackwell |
| 11 ASCENSO Y DESCENSO | paused - Detenido | Interno Futbol; Ascenso 4T |
| 12 MTV | active | Interno Tello; Tello + Blackwell |
| 13 GRUPO CIMA | active | CIMA + Blackwell; Interno CIMA (historical fallback jid) |
| 14 DALINDE | active | Dalinde + Blackwell; Comunicacion DSAI + Blackwell; Edicion Notas Blackwell |
| 18 STPRM | active | Comms Lider |
| 20 VERACRUZ | active | Interno Veracruz; Veracruz Medios (from Excel; not yet present in Supabase) |
| 21 Nuvoil | active | INTERNO NUVOIL; Nuvoil-Blackwell |
| 26 BERNARDO V | active | Interno Bernardo V; BV seguimiento Instagram |
| 29 COAST OIL | active | INTERNO COAST OIL; Coast Oil + Blackwell |
| 34 SUPPLY_PAY | active | SupplyPay + Blackwell |
| 35 PEPE AGUILAR | active | ESTRATEGIA CRISIS PPA; Interno Pepe Aguilar |
| 38 KARPOWERSHIP | active | Interno KPS; Blackwell & KPS |
| 39 ISMERELY | active | BLACKWELL \| ISMERELY |
| 40 AUSTRIA | active | Interno Austria (from Excel; not yet present in Supabase) |
| 41 IFA CELTICS | active | IFA + Blackwell; Interno IFA |
| 42 MTV Linkedin | active | Mario Q + Blackwell (needs human review; name mismatch) |
| 44 LCH Luxury Travel | active | Interno LCH; Blackwell + LCH |

## Active Projects Without WhatsApp Group Yet

These are active in the screenshots/local project map but no mapped `wa_groups.account_id` exists yet.

| Project | Status note |
| --- | --- |
| 17 IRUGAMI | active |
| 19 Casa Mata | active |
| 27 CUERNAVACA | active |
| 28 QUERETARO | active |
| 30 ERICK RUBI | active |
| 33 NEZA | active |
| 43 IRAN GUERRERO | active |
| 45 INOVAMEDIK | active |

## Non-Active Projects Without WhatsApp Group

Kept in the map with their status note, but not urgent for live WhatsApp mapping unless their groups are still active.

| Project | Status |
| --- | --- |
| 03 ADUANAS | proyecto concluido |
| 04 IDLAYR | proyecto concluido |
| 08 ULDIS | terminacion anticipada; Excel lists `Interno Uldis`, not currently present in Supabase. |
| 10 JACK LEVI | detenido |
| 15 ARMOR LIFE LAB | terminacion anticipada |
| 16 MAPELLY | proyecto concluido |
| 22 TOTALPLAY | proyecto concluido |
| 23 LUCA | terminacion anticipada |
| 24 GICSA | proyecto concluido |
| 31 SASIL | proyecto concluido |
| 32 COJAB | proyecto concluido |
| 37 LEADSALES | proyecto concluido |

## Pending / Unknown Projects

| Slot | Note |
| --- | --- |
| 25 ANDY | Exists in local dashboard data, but was not visible in the provided screenshots. |
| 36 | Not visible in the provided screenshots. Need folder/client name. |
| PUJOL | Appears in the Excel update without WhatsApp groups and without a project number. Confirm whether this is a new project, a replacement for another slot, or an alias before adding it to the canonical map. |

## WhatsApp Groups Still Without Project Mapping

These remain `account_id = 00_UNMAPPED` because the name does not safely match a captured project folder.

| WhatsApp group | Suggested next step |
| --- | --- |
| AI Team | Internal/general; confirm if it should stay unmapped. |
| BWS - QO Tech | Confirm project/client. |
| HH / Tebo | Confirm project/client. |
| LAB-BWS OPERATIVO | Excel lists this same group for IRUGAMI, CUERNAVACA, QUERETARO, NEZA, and IRAN; keep unmapped/shared unless a many-to-many relation is added. |
| Prueba | Test group; likely should stay unmapped or inactive. |

## Needs Human Review

| Current mapping | Why review |
| --- | --- |
| `42` MTV Linkedin -> Mario Q + Blackwell | The project folder says MTV Linkedin, but the group name says Mario Q. |
| Project 36 | Missing from screenshots; could explain one of the unmapped groups. |
| PUJOL | Appears in the Excel update but not in the screenshot-derived 45-project catalog. |
| Shared LAB groups | `LAB-BWS OPERATIVO` / `Seguimiento Labs` appear under multiple clients; current `wa_groups.account_id` supports one project only. |
