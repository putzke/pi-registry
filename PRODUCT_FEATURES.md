# Cirrus Cc — Product Feature Summary

*Formerly Horizon COMPASS. Tagline: "Consultant to client, in real time." Web: cirruscc.com.*

*Current as of October 4, 2026. A plain-language summary of what the product does today, for use as source material for the product website and sales materials. Developer documentation lives in `CLAUDE.md`.*

---

## What it is

Cirrus Cc is the system of record for **public involvement (PI) consultants** working on FHWA/NEPA-regulated transportation and infrastructure projects. Its users are the consultant's own team, not the public. It handles three jobs in one place:

1. **The daily PI workflow.** Contacts, every logged conversation, follow-ups, issues, commitments, deliverables, events and right-of-way outreach.
2. **Compliance documentation.** NEPA classification and checklists, comment periods, hearing notice timing, Title VI / LEP / Environmental Justice tracking, and reports that hold up as a record.
3. **Live reporting to the client.** A client portal that shows the agency client what the PI team is doing on its behalf, without a manual reporting cycle.

It is built for small-to-mid PI consulting firms doing UDOT, county and municipal work, and by a working PI professional. It is designed to complement agency-side public engagement platforms, not replace them.

**Three apps, one database:**
- **Desktop app.** The full workspace.
- **Mobile app.** A field companion for logging and looking things up on site.
- **Client portal.** A read-only view for the agency client.

---

## 1. Stakeholder and contact management

- **Master stakeholder registry plus project contact lists.** A contact can belong to the firm's master list, be reused across projects, or stay project-only. Their role (internal team or external), support level, influence and distribution groups are tracked per project.
- **13 stakeholder types:** Business, Elected Official, Agency, Community Group, Contractor, Engineering, Media, Property Owner, Resident, Tribal, Utility, Non-profit and Other.
- **Title VI / Environmental Justice fields on every contact:** Limited English Proficiency (LEP) and underserved / EJ population. These can be filtered and reported on.
- **Duplicate detection**, with a dismiss option for pairs that are genuinely different people.
- **Search by name, organization, email, phone or parcel number.**
- **Bulk add with AI contact import.** Paste a sign-in sheet, an email signature block or a list, or attach a photo or PDF of a sign-in sheet. AI extracts the contacts into a review grid, and nothing is saved until a person reviews it. (Contacts only. Interactions are never AI-generated.)
- **Import tool** for spreadsheets of stakeholders, interactions and parcels. It maps columns automatically, previews every row before anything is written, and skips duplicates. It refuses to run if it can't check what's already in the database, so a dropped connection can never create duplicate records.
- **"Needs review" placeholder contacts** for door-to-door canvassing (see Map). They are clearly badged until someone confirms who lives or owns there.

## 2. Interaction logging

- **Log every contact with the public and stakeholders:** date, who, channel (phone, email, in-person, public meeting, comment card, mail, and more), direction (outgoing, incoming, in-person), subject, nature, summary and who logged it.
  - **Subjects:** General, Traffic, Property Access, Property Issue, Environmental, Utility Service, Information, Noise / Hours, ROW / Easement, Other.
  - **Natures:** Inquiry, Complaint, Compliment, Comment, Request, Concern, Support, Notification.
- **Anonymous callers are first-class.** An unnamed member of the public is logged with an automatic label ("Anonymous 3") and counted as public contact in every report.
- **Quick Log grid** for batch entry: log a dozen calls or a mass notification in one screen, with copy-down for date, channel, direction, subject and nature.
- **Follow-ups** with a due date, an owner, reassignment to a teammate, overdue flags and resolution notes. An "Assigned to me" view appears on both desktop and mobile.
- **NEPA stage tagging** on interactions, and an equity form flag for public events.
- **Every interaction is entered by a person.** No interaction record is ever created by AI, because each one is a compliance claim that can end up in an FHWA/NEPA report.

## 3. Issues, commitments, deliverables and events

- **Issues tracker.** Category, priority, status, linked interactions, resolution summary, and Word exports of a single issue or a summary of all of them.
- **Commitments to the public.** Who each was made to, due date, status and date fulfilled. Overdue commitments are flagged.
- **Deliverables and scope tracking.** Contracted quantities with a +/- delivered counter and a progress bar. Supports milestone, recurring-cadence and fixed-quantity deliverables, each shown correctly (a recurring newsletter has a cadence, not a fake deadline).
- **Events and meetings.** Attendees, equity and Title VI toggles, and action-item notes.
- **Dashboard** focused on exceptions: overdue follow-ups, and how long since each client last received a status report.

## 4. NEPA and compliance

- **NEPA classification and stage on every project** (CE, EA, EIS; Draft, Final, Post-NEPA / Construction).
- **Classification-specific NEPA checklists** with UDOT and CFR citations: 33 items for a CE and 49 for an EA, with the date each was checked and who checked it. Progress shows on project cards.
- **Comment periods and the formal public comment record:** each comment, commenter, method, category, response status, who responded and an internal note.
- **Hearing notice timing check** against Utah Admin Code R930-2-5: the first notice at least 14 days before the hearing, the second 5–10 days before. The check is advisory and never blocks a save, so a late notice is still recorded truthfully.
- **Title VI / LEP / EJ reporting:** the PI compliance report section counts flagged contacts and equity-form events.
- **A NEPA Compliance report**, available both as a quick report and as a section in the PI report.

## 5. Right-of-way (ROW) and property owner outreach

- **A parcel register built for many-to-many ownership:** co-owners, heirs, an LLC and its manager, and one owner holding several parcels. The parcel, not the person, is the unit of compliance.
- **Per parcel:**
  - situs address (where the land is), alongside each owner's mailing address;
  - survey coordinates, for unsubdivided land;
  - acquisition type (full take, partial take, temporary or permanent easement, access only);
  - acquisition status (Not started, Notice sent, Contacted, Negotiating, Acquired, Declined);
  - notice date, and the dates the legal description and the design exhibit were shared.
- **Duplicate guard.** The same parcel number can't be entered twice on a project, even written differently (`12-047-0001` and `120470001` are recognized as the same parcel).
- **Outreach tracking for the ROW agents.** For each parcel contact:
  - their role (owner, co-owner, tenant, agent, property manager, heir);
  - whether they have **authority to sign**;
  - how they received the project (Willing, Has questions, Resistant, Won't engage);
  - their concerns;
  - how many times they've been contacted, and when last.

  A parcel with nobody marked as able to sign is flagged.
- **ROW register export.** Print, or Excel with three sheets:
  - the **parcel register** (coverage);
  - a **mailing list**, one row per parcel per owner, for notice mailings;
  - an **agent briefing**, who can sign, sentiment and concerns, for the acquisition team.

  Unsent notices are flagged, and real Excel dates sort correctly.
- **No dollar figures in PI records** by design. Appraisals and offers belong to the ROW agents.
- **Owner privacy.** Owner names, concerns and internal notes never reach the client portal or client reports. Those show counts only.

## 6. Map and geospatial tools

- **Contacts and parcels on one map.** Contacts are shown at their mailing addresses and parcels at their land locations, with parcels colored by acquisition status and labeled with the parcel number.
- **Honest about location accuracy.** When the geocoder could only place an address approximately, the map says so instead of implying precision. Parcels that land on the same point are grouped and explained, and anything that can't be placed is listed rather than silently dropped.
- **Printable map** with a matching legend table.
- **Draw an area, get an answer.** Draw any shape — a corridor, a neighborhood, around a school — and see every stakeholder and parcel inside it, with LEP and EJ counts called out for environmental justice analysis. Hand the result straight to the contact list.
- **Reconcile with the state parcel layer.** Check tracked parcel numbers against Utah's statewide parcel GIS (UGRC) to confirm the county has each one, and fill in missing coordinates.
- **Discover untracked parcels.** Inside a drawn area, see every parcel in the state layer that isn't tracked yet, outlined on the map, and import the ones you want after review.
- **Canvassing placeholders.** For a door-to-door canvass, a drawn area offers up to 10 street addresses with no contact yet. It creates "Property 1, 2, 3…" placeholder contacts flagged **Needs review**, ready to confirm in the field on the mobile app.

## 7. PI reports

- **Report editor with a live preview.** Pick and order sections, set the reporting period and see the finished report as you edit. Sections include:
  - recent public concerns;
  - interaction log;
  - follow-ups;
  - deliverables;
  - commitments;
  - issues;
  - events;
  - contact list;
  - sentiment;
  - public comment matrix;
  - parcels;
  - PI and NEPA compliance.
- **AI-drafted narratives.** Each section can be drafted by AI, or every section at once. The facts are computed by the app and handed to the AI as authoritative: **the AI writes the prose and never counts.** The writing is plain (about a 9th–10th grade reading level), uses one consistent voice across the report, and treats early outbound notification work as normal rather than as a gap. The consultant reviews and edits everything.
- **Privacy controls that hold in the exported file.** Turning off a section's data table removes the individual records from the Word export too, not just from the preview.
- **Word (.docx) export** with Sunrise, Sunrise Alt or UDOT letterhead (or none). The letterhead prints on the first page only.
- **Report archive.** Each archived report is frozen as it was issued, so a later edit can't change what the client already has. The **final hand-edited Word file** can be attached as the report of record and shared with the client for download.
- **Project Status Report (AI).** Compares where the project is now against its baseline and the last report:
  - schedule elapsed against deliverables complete;
  - pace;
  - commitments;
  - open issues;
  - change in engagement.
- **Quick reports** for common one-off needs: parcel status, NEPA compliance, issues and more.

## 8. PI close-out report

The final deliverable to the client at project close. For UDOT, this is the construction-phase PI close-out letter report to the Region.

- **Guided intake.** Only the recipient and signature are required. The app computes the project's own numbers (interactions, inbound calls, stakeholders, reports, events, issues, commitments kept), and the intake asks only for what the app can't know. Any typed figure is footnoted as the consultant's own.
- **AI drafting for the PI highlights** (outreach, website, concerns, coordination, email, traffic, social media) and for the **Stakeholder Communications Log Summary**, a synthesis of the whole interaction log. It refers to private individuals by role, never by name.
- **Computed sections:**
  - PI Program at a Glance;
  - Commitments to the Public;
  - Right-of-Way and Property Owner Outreach (counts only);
  - Delivery Against Scope of Work;
  - Stakeholder Engagement in Figures. Charts show contacts per month (outbound vs. inbound), contacts by channel, inbound topics, stakeholder types, cumulative website visits and issues escalated. The charts are designed to print legibly in black and white.
- **Live preview and Word export** with real hyperlinks and letterhead. Unfinished spots are highlighted, and export warns before any of them ship.

## 9. Client portal

- **Two ways in:** a private link for a single project (no login), or an email sign-in link for clients with several projects.
- **What the client sees:**
  - a NEPA stage banner;
  - project overview tiles;
  - deliverable progress with percentages;
  - an 8-week engagement trend chart;
  - "Coming Up" for the next 60 days;
  - a "Heads Up" panel for anything urgent;
  - issues, commitments and comment periods;
  - right-of-way coverage, without owner names;
  - **Project Updates**: shared PI reports (download the final Word file) and the current status narrative.
- **The consultant controls what's shared.** Reports are visible to the client only when the consultant shares them, and only once a final file is attached.
- **Real server-side data isolation.** Each private link, and each signed-in client, can read only their own project's data. This is enforced by the database itself, not just the page.

## 10. Mobile app

- **Built for the field:** log an interaction on the spot, look up a contact, call or email them, check follow-ups assigned to you, and review issues.
- **Read-only parcel details** at the parcel: number, location, status and notice date.
- **Canvassing support.** Placeholder contacts show **Needs review** and the address to visit. Once you've spoken with the owner or resident, fill in their name and untick the flag.
- **Logging only.** Imports and the scanning-based AI tools are deliberately left off the phone.

## 11. Data integrity, privacy and quality

- **Edit-conflict protection.** If two people edit the same contact, interaction or issue at once, the app notices instead of silently overwriting.
- **No silent data loss.** A failed load is reported rather than shown as an empty list, on desktop, on mobile and in the import tool.
- **Privacy built into AI use.** Contact names are kept out of the facts sent to AI for the close-out log summary, and the AI is told never to name private individuals.
- **An automated test suite**, 63 test files run against a real database, checks every feature above, including the security and data-isolation rules. Each fix is checked against the original bug before it ships.

---

## Roadmap: not yet available

*Don't present these as current features.*

- **ArcGIS Survey123 ingestion.** Bring survey responses into the public comment record, with location. Design is complete and waiting on a sample export.
- **Phone hotline voicemail transcription** into logged interactions. Vendor not yet chosen.
- **County assessor lookup** for owner names and mailing addresses from parcel numbers.
- **Google Sheets sync** for the ROW register.
- **Multi-firm hosting and built-in AI** (no personal AI key needed). Required before selling to other firms. Target 2027.
- **Tribal consultation tracker.** Built but deliberately hidden until it has been fully validated.

## Notes for website copy

- **Interactions are never AI-generated.** The AI drafts report prose from facts the app computes; people enter the records and review the drafts.
- **Position it as complementary** to agency-side engagement platforms (for example PublicInput or Granicus). Those tools help the agency reach the public; Cirrus Cc is the consultant's own workspace and their reporting line to the client.
- **Check competitive claims before publishing.** Internal notes say no researched competitor offers NEPA-specific workflows, a consultant-to-client portal or a draw-a-shape stakeholder query, but that was a June 2026 review. Confirm it before printing "only" or "first".
- **Use firm-neutral language** where the site targets other firms. Some features (the Sunrise letterheads, the UDOT close-out format) are specific to Sunrise and UDOT today.
