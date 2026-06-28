// ============================================================
// HORIZON COMPASS — Sample Data Seed Script
// Paste into browser DevTools console on the live app page.
// Creates 3 Utah UDOT/FHWA projects with full stakeholder,
// interaction, public comment, meeting, deliverable, and
// NEPA checklist data. Safe to re-run — checks for existing
// projects by PID before inserting.
// ============================================================

(async function SEED() {
  if (typeof DB === 'undefined') {
    console.error('COMPASS app not detected. Open the app first, then paste this script.');
    return;
  }

  const existing = DB.get('projects').map(p => p.pid);
  if (existing.includes('20001') || existing.includes('20002') || existing.includes('20003')) {
    console.warn('Sample data already seeded (PIDs 20001/20002/20003 found). Skipping.');
    return;
  }

  const uid = () => DB.uid();
  const today = new Date().toISOString().slice(0,10);

  // ── NEPA EA checklist items (partial completion for demo) ──
  const EA_LABELS = [
    'Public information from project sponsor reviewed by PI team (Task 01E)',
    'Project stakeholders identified in coordination with Project Manager, RCM, and Communications Office',
    'PI strategy meeting held with project team — PI goals and evaluation criteria established',
    'Community outreach strategies developed to meet PI Plan objectives',
    'Media plan developed with RCM and Communications Office',
    'Project Public Involvement (PI) Plan prepared (Task 05E)',
    'PI Plan reviewed and approved by Environmental Program Manager and RCM before distribution',
    'PI Plan implemented throughout planning and design process (Task 07E)',
    'NEPA scoping letters sent to agencies, tribes, and known interested parties (Task 13E)',
    'Official written notification sent to tribal chairpersons of federally-recognized Indian Tribes in Utah for projects with potential tribal implications (UDOT 08A2-07)',
    'Tribal consultation initiated as early as possible and conducted in good faith; technical information shared with Tribes upon request (UDOT 08A2-07 / Utah EO 2014/005)',
    'NEPA scoping meeting(s) held — public and agency input solicited',
    'Tribal comments and concerns documented and considered; consultation activities retained in project file',
    'NEPA scoping report prepared',
    'Draft EA circulated to agencies and public for review (Task 35E)',
    'Public hearing location selected: in project area, ADA-accessible, adequate size, accessible elevator if multi-floor (Task 39E)',
    'Public hearing approval obtained from Environmental Program Manager',
    'Public hearing advertised on UDOT website under Public Meetings and Events',
    'UDOT Title VI Specialist invited to public hearing',
    'Public hearing advertised: first ad ≥15 days prior, second ad 7–10 days prior',
    'Community demographics reviewed — translators arranged if needed; interpretation services advertised on flyers',
    'Meeting collateral includes Notice of Special Accommodation statement (auxiliary communicative aids and services)',
    'Non-discrimination poster displayed at public hearing venue',
    'Title VI-approved sign-in sheet used at each table — captures name/affiliation, contact info, project info opt-in, and optional gender/race fields (CFR 23 §200.9(4))',
    'Comment collection method provided at public hearing',
    'Court recorder obtained for public hearing',
    'Public hearing held — compliant with UDOT Title VI Program (non-discrimination: race, color, national origin, sex, age, disability, income status)',
    'Scanned sign-in sheets and copies of comments emailed to Title VI Coordinator (civilrights@utah.gov) after hearing',
    'Post-meeting Title VI Summary form completed and submitted to civilrights@utah.gov',
    'Public hearing transcript prepared and distributed to project team and interested individuals, groups, and agencies (UDOT 08A2-02)',
    'EA public comment period completed — minimum 30 days (Task 39E)',
    'All public and agency comments compiled into comment resolution form (Task 41E)',
    'Written response prepared for each comment',
    'Public hearing certification package assembled (Task 41E)',
    'Public hearing summary and analysis report prepared and QC reviewed',
  ];

  const CE_LABELS = [
    'Public meeting requirement assessed and documented (required if project adds through travel lanes, substantially changes facility layout, or results in substantial adverse impacts)',
    'If public meeting held: advertised on UDOT website under Public Meetings and Events',
    'If public meeting held: UDOT Title VI Specialist invited to meeting',
    'If public meeting held: location selected in project area — ADA-accessible, adequate size, accessible elevator if multi-floor',
    'If public meeting held: signage is readable; accessibility accommodations confirmed',
    'If public meeting held: community demographics reviewed — translators arranged if needed',
    'If public meeting held: meeting collateral includes Notice of Special Accommodation statement (auxiliary communicative aids and services)',
    'If public meeting held: non-discrimination poster displayed at meeting venue',
    'If public meeting held: Title VI-approved sign-in sheet used at each table (race, sex, disability options)',
    'If public meeting held: meeting materials / flyers translated for non-English-speaking demographics; interpretation services advertised',
    'If public meeting held: comment collection method provided',
    'If public meeting held: scanned sign-in sheets and copies of comments emailed to Title VI Coordinator (civilrights@utah.gov)',
    'If public meeting held: post-meeting Title VI Summary form completed and submitted to civilrights@utah.gov',
    'If public meeting held: advertised per FHWA and Utah regulations (first ad ≥15 days prior)',
    'If public meeting held: comments and responses summarized and included in CE document',
    'If public meeting held: public hearing transcript and certification attached to CE document',
    'Non-discrimination compliance confirmed — race, color, national origin, sex, age, disability, religion, income status, gender identity, sexual orientation',
    'All other public involvement activities documented with supporting information in project file',
    'Environmental Commitments Signature Page signed and included in CE document',
    'Mitigation commitments entered in ePM and included in project file'
  ];

  function makeChecklist(labels, checkedCount) {
    return labels.map((label, i) => ({
      label,
      checked: i < checkedCount,
      checkedDate: i < checkedCount ? '2025-0' + (Math.floor(i/4)+1) + '-' + String((i%28)+1).padStart(2,'0') : '',
      checkedBy: i < checkedCount ? 'J. Putzke' : ''
    }));
  }

  // ── PROJECT IDs ──
  const p1 = uid(), p2 = uid(), p3 = uid();

  // ── PROJECTS ──
  const newProjects = [
    {
      id: p1, pid: '20001',
      name: 'US-89 Corridor Safety & Capacity Improvements — Farmington to Layton',
      client: 'UDOT Region 1',
      type: 'Roadway', county: 'Davis',
      phase: 'EA - Draft',
      status: 'Active',
      startDate: '2024-03-01', endDate: '2027-09-30', preconDate: '2026-06-01',
      nepaClassification: 'EA',
      nepaStage: 'EA - Draft',
      phaseHistory: [],
      nepaStageHistory: [
        { from: '', to: 'Pre-NEPA', date: '2024-03-01', by: 'J. Putzke' },
        { from: 'Pre-NEPA', to: 'EA - Scoping', date: '2024-07-15', by: 'J. Putzke' },
        { from: 'EA - Scoping', to: 'EA - Draft', date: '2025-01-10', by: 'J. Putzke' }
      ],
      nepaChecklist: makeChecklist(EA_LABELS, 22),
      notes: 'High-volume commuter corridor. EJ communities in South Layton require Spanish and Tongan outreach materials. Noise wall ballot required for 3 residential segments.'
    },
    {
      id: p2, pid: '20002',
      name: 'SR-97 Intersection Improvements — Springville Main St at 400 South',
      client: 'UDOT Region 3',
      type: 'Roadway', county: 'Utah',
      phase: 'Construction',
      status: 'Active',
      startDate: '2025-01-15', endDate: '2026-03-31', preconDate: '2025-04-07',
      nepaClassification: 'CE',
      nepaStage: 'Post-NEPA / Construction',
      phaseHistory: [
        { from: '', to: 'Design', date: '2025-01-15', by: 'J. Putzke' },
        { from: 'Design', to: 'Construction', date: '2025-04-07', by: 'J. Putzke' }
      ],
      nepaStageHistory: [
        { from: '', to: 'CE', date: '2025-01-15', by: 'J. Putzke' },
        { from: 'CE', to: 'Post-NEPA / Construction', date: '2025-04-07', by: 'J. Putzke' }
      ],
      nepaChecklist: makeChecklist(CE_LABELS, 17),
      notes: 'Signalized intersection replacement and turn lane additions. Main St business district — high sensitivity. LDS Church and Springville Arts City Museum adjacent to ROW.'
    },
    {
      id: p3, pid: '20003',
      name: 'I-15 Price / Carbon County Access Study — Helper to Wellington',
      client: 'UDOT Region 4 / FHWA Utah Division',
      type: 'Planning / Study', county: 'Carbon',
      phase: 'NEPA / Environmental',
      status: 'On hold',
      startDate: '2023-11-01', endDate: '2026-12-31', preconDate: '',
      nepaClassification: 'EA',
      nepaStage: 'EA - Scoping',
      phaseHistory: [],
      nepaStageHistory: [
        { from: '', to: 'Pre-NEPA', date: '2023-11-01', by: 'J. Putzke' },
        { from: 'Pre-NEPA', to: 'EA - Scoping', date: '2024-05-20', by: 'J. Putzke' }
      ],
      nepaChecklist: makeChecklist(EA_LABELS, 11),
      notes: 'Rural corridor study. Project paused pending funding authorization. Tribal coordination with Ute Indian Tribe of the Uintah and Ouray is ongoing. EJ populations in Helper city limits.'
    }
  ];

  // ── STAKEHOLDER IDs ──
  const s = Array.from({length: 22}, () => uid());

  // ── STAKEHOLDERS (master) ──
  const newStakeholders = [
    // US-89 / Davis County stakeholders
    { id: s[0], firstName: 'Brenda', lastName: 'Whitmore', org: 'UDOT Region 1', title: 'Project Manager', email: 'bwhitmore@utah.gov', phone: '(801) 620-1400', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '166 W Southwell St, Ogden, UT 84404', isMaster: true, stakeholderRole: 'Internal', isLEP: false, isEJ: false, notes: 'Lead client PM. Receives all PI progress reports. Prefers concise email summaries.' },
    { id: s[1], firstName: 'Marcus', lastName: 'Taufa', org: 'South Layton Tongan Community Association', title: 'President', email: 'mtaufa@sltca.org', phone: '(801) 555-0211', prefContact: 'Phone', type: 'Community Group', influenceTier: 'High', address: '1400 N Fairfield Rd, Layton, UT 84041', isMaster: true, stakeholderRole: 'External', isLEP: true, isEJ: true, notes: 'Primary contact for Tongan-speaking LEP community (~350 households). Requests all materials in Tongan and English. Strong community mobilizer.' },
    { id: s[2], firstName: 'Rep. Angela', lastName: 'Romero', org: 'Utah House of Representatives', title: 'District 26 Representative', email: 'aromero@le.utah.gov', phone: '(801) 555-0309', prefContact: 'Email', type: 'Elected Official', influenceTier: 'High', address: 'Utah State Capitol, Salt Lake City, UT', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Constituent advocacy focus on EJ communities along US-89. Wants briefings before public hearings.' },
    { id: s[3], firstName: 'Karl', lastName: 'Jensen', org: 'Farmington City', title: 'City Engineer', email: 'kjensen@farmington.utah.gov', phone: '(801) 939-9201', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '160 S Main St, Farmington, UT 84025', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Utility coordination and signal timing. Requires 30-day advance notice for any work within city limits.' },
    { id: s[4], firstName: 'Diana', lastName: 'Lucero', org: 'FHWA Utah Division', title: 'Environmental Program Specialist', email: 'diana.lucero@dot.gov', phone: '(801) 955-3500', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '2520 W 4700 S, Taylorsville, UT 84129', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Federal oversight on NEPA compliance and Title VI. Reviews all EA documents. Attends public hearings.' },
    { id: s[5], firstName: 'Cheryl', lastName: 'Nakashima', org: 'Davis County Health Department', title: 'Environmental Health Director', email: 'cnakashima@daviscountyutah.gov', phone: '(801) 525-5100', prefContact: 'Email', type: 'Agency', influenceTier: 'Medium', address: '22 S State St, Clearfield, UT 84015', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Air quality and noise concerns. Provided comments during scoping.' },
    { id: s[6], firstName: 'Troy', lastName: 'Allred', org: 'Layton Hills Neighborhood Alliance', title: 'Chair', email: 'tallred@lhna.org', phone: '(801) 555-0487', prefContact: 'Email', type: 'Community Group', influenceTier: 'Medium', address: '450 Hillcrest Dr, Layton, UT 84040', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Noise wall ballot organizer. Has been monitoring project closely since scoping. Represents ~200 households in potential noise impact zone.' },
    { id: s[7], firstName: 'Peni', lastName: 'Fifita', org: 'Layton Pacific Islander Health Coalition', title: 'Outreach Coordinator', email: 'pfifita@lpihc.org', phone: '(801) 555-0512', prefContact: 'Phone', type: 'Community Group', influenceTier: 'Medium', address: '812 W Gordon Ave, Layton, UT 84041', isMaster: true, stakeholderRole: 'External', isLEP: true, isEJ: true, notes: 'Health equity advocate. Bilingual English/Tongan. Assists with community outreach translation and meeting facilitation.' },

    // SR-97 / Springville stakeholders
    { id: s[8], firstName: 'Robert', lastName: 'Aagard', org: 'UDOT Region 3', title: 'Construction Resident Engineer', email: 'raagard@utah.gov', phone: '(801) 227-8050', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '658 N Main St, Springville, UT 84663', isMaster: true, stakeholderRole: 'Internal', isLEP: false, isEJ: false, notes: 'On-site RE. Daily point of contact for construction coordination.' },
    { id: s[9], firstName: 'Mayor David', lastName: 'Oyler', org: 'Springville City', title: 'Mayor', email: 'doyler@springville.utah.gov', phone: '(801) 491-7848', prefContact: 'Email', type: 'Elected Official', influenceTier: 'High', address: '110 S Main St, Springville, UT 84663', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'High profile project through historic downtown Main St. Mayor\'s office requests monthly status briefing.' },
    { id: s[10], firstName: 'Glen', lastName: 'Harrop', org: 'Springville Art City Chamber of Commerce', title: 'Executive Director', email: 'gharrop@springvillechamber.com', phone: '(801) 491-6218', prefContact: 'Email', type: 'Business Group', influenceTier: 'High', address: '110 S Main St, Springville, UT 84663', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Vocal advocate for business access. Wants construction windows limited to off-peak hours. Distributes project updates through Chamber newsletter (1,400 members).' },
    { id: s[11], firstName: 'Sister Karen', lastName: 'Petersen', org: 'The Church of Jesus Christ of Latter-day Saints', title: 'Chapel Facility Manager', email: 'kpetersen@ldschurch.org', phone: '(801) 555-0621', prefContact: 'Phone', type: 'Community Group', influenceTier: 'Medium', address: '230 S 400 W, Springville, UT 84663', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Coordination needed for Sundays and Wednesday evenings — high attendance. Parking impact sensitivity.' },
    { id: s[12], firstName: 'Lori', lastName: 'Vance', org: 'Springville Art Museum', title: 'Director', email: 'lvance@sartmuseum.org', phone: '(801) 489-2727', prefContact: 'Email', type: 'Community Group', influenceTier: 'Medium', address: '126 E 400 S, Springville, UT 84663', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: '"Art City" brand identity sensitive to visual construction impacts. Requesting construction aesthetic screening on Main St frontage.' },
    { id: s[13], firstName: 'Jorge', lastName: 'Contreras', org: 'Centro Hispano Comunitario de Utah Valley', title: 'Director', email: 'jcontreras@centrophc.org', phone: '(801) 555-0733', prefContact: 'Phone', type: 'Community Group', influenceTier: 'Medium', address: '190 W 400 S, Orem, UT 84058', isMaster: true, stakeholderRole: 'External', isLEP: true, isEJ: true, notes: 'Represents Spanish-speaking residents along the 400 South corridor. LEP population. Assisted with bilingual flyer distribution for pre-con notice.' },

    // Carbon County / I-15 study stakeholders
    { id: s[14], firstName: 'Nathan', lastName: 'Begay', org: 'Ute Indian Tribe — Uintah & Ouray Agency', title: 'THPO Director', email: 'nbegay@utetribe.com', phone: '(435) 722-5141', prefContact: 'Email', type: 'Tribal Government', influenceTier: 'High', address: '988 S 7500 W, Fort Duchesne, UT 84026', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: true, notes: 'Section 106 tribal consultation lead. Project corridor passes near traditional cultural properties. Formal written notification sent per UDOT 08A2-07.' },
    { id: s[15], firstName: 'Carol', lastName: 'Crandall', org: 'Carbon County Commission', title: 'Commission Chair', email: 'ccrandall@carbon.utah.gov', phone: '(435) 636-3200', prefContact: 'Email', type: 'Elected Official', influenceTier: 'High', address: '120 E Main St, Price, UT 84501', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Strong local government support for access improvements. Economic development priority for Carbon County.' },
    { id: s[16], firstName: 'Mike', lastName: 'Schofield', org: 'Helper City', title: 'Mayor', email: 'mschofield@helpercity.com', phone: '(435) 472-5391', prefContact: 'Phone', type: 'Elected Official', influenceTier: 'Medium', address: '20 S Main St, Helper, UT 84526', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Project on hold frustrating local officials. Arts community in Helper downtown. Wants regular updates even during hold.' },
    { id: s[17], firstName: 'Rita', lastName: 'Archuleta', org: 'Helper EJ Community Coalition', title: 'Founder', email: 'rarchuleta@helpercoa.org', phone: '(435) 555-0841', prefContact: 'Email', type: 'Community Group', influenceTier: 'Medium', address: '85 S Main St, Helper, UT 84526', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: true, notes: 'Environmental justice advocate for lower-income Hispanic and Indigenous residents in Helper. Monitor for disproportionate project impacts.' },

    // Shared / internal team
    { id: s[18], firstName: 'Jeff', lastName: 'Putzke', org: 'Sunrise Engineering', title: 'PI Services Manager', email: 'jputzke@sunriseengineering.com', phone: '(801) 555-0101', prefContact: 'Email', type: 'Consultant', influenceTier: 'High', address: '3169 N 400 W, Lehi, UT 84043', isMaster: true, stakeholderRole: 'Internal', isLEP: false, isEJ: false, notes: 'Project PI lead. Manages all public contact, reporting, and compliance documentation.' },
    { id: s[19], firstName: 'Amy', lastName: 'Stratton', org: 'Sunrise Engineering', title: 'Environmental Scientist', email: 'astratton@sunriseengineering.com', phone: '(801) 555-0102', prefContact: 'Email', type: 'Consultant', influenceTier: 'High', address: '3169 N 400 W, Lehi, UT 84043', isMaster: true, stakeholderRole: 'Internal', isLEP: false, isEJ: false, notes: 'NEPA document lead. Coordinates agency review cycles. Working with FHWA on EA content.' },
    { id: s[20], firstName: 'Tina', lastName: 'Morales', org: 'UDOT Office of Civil Rights', title: 'Title VI / LEP Coordinator', email: 'tmorales@utah.gov', phone: '(801) 965-4150', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '4501 S 2700 W, Salt Lake City, UT 84114', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'Title VI sign-off required on all public meetings. Receives sign-in sheet scans and post-meeting forms. Coordinates LEP/EJ compliance reviews.' },
    { id: s[21], firstName: 'Utah State', lastName: 'Historic Preservation Office', org: 'UDOT / SHPO', title: 'Section 106 Coordinator', email: 'shpo@utah.gov', phone: '(801) 245-7215', prefContact: 'Email', type: 'Agency', influenceTier: 'High', address: '300 S Rio Grande St, Salt Lake City, UT 84101', isMaster: true, stakeholderRole: 'External', isLEP: false, isEJ: false, notes: 'SHPO coordination required for all three projects. Section 106 review initiated for Carbon County study.' }
  ];

  // ── PROJECT-STAKEHOLDER LINKS ──
  const newPS = [
    // US-89 (p1)
    { id: uid(), projectId: p1, stakeholderId: s[0], support: 'Champion', issueTags: 'Schedule,Budget', addedDate: '2024-03-01', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'Primary client contact.' },
    { id: uid(), projectId: p1, stakeholderId: s[1], support: 'Neutral', issueTags: 'LEP,EJ,Noise,Displacement', addedDate: '2024-04-15', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'All materials in Tongan. Key community liaison.' },
    { id: uid(), projectId: p1, stakeholderId: s[2], support: 'Supportive', issueTags: 'EJ,Title VI', addedDate: '2024-04-20', distributionGroups: 'Elected officials', stakeholderRole: 'External', notes: 'Brief before each public event.' },
    { id: uid(), projectId: p1, stakeholderId: s[3], support: 'Neutral', issueTags: 'Utility,Signal timing', addedDate: '2024-03-15', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: '30-day advance for work in city.' },
    { id: uid(), projectId: p1, stakeholderId: s[4], support: 'Neutral', issueTags: 'NEPA,Title VI,EA Review', addedDate: '2024-03-01', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Federal oversight. Attends public hearings.' },
    { id: uid(), projectId: p1, stakeholderId: s[5], support: 'Neutral', issueTags: 'Air quality,Noise', addedDate: '2024-05-10', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Provided scoping comments on emissions.' },
    { id: uid(), projectId: p1, stakeholderId: s[6], support: 'Opponent', issueTags: 'Noise wall,Night work', addedDate: '2024-06-01', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Leading noise wall ballot effort.' },
    { id: uid(), projectId: p1, stakeholderId: s[7], support: 'Neutral', issueTags: 'LEP,EJ,Health', addedDate: '2024-04-18', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Bilingual outreach facilitator.' },
    { id: uid(), projectId: p1, stakeholderId: s[18], support: 'Champion', issueTags: '', addedDate: '2024-03-01', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'PI lead.' },
    { id: uid(), projectId: p1, stakeholderId: s[19], support: 'Champion', issueTags: 'NEPA,EA', addedDate: '2024-03-01', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'NEPA doc lead.' },
    { id: uid(), projectId: p1, stakeholderId: s[20], support: 'Neutral', issueTags: 'Title VI,LEP,EJ', addedDate: '2024-04-01', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Title VI compliance sign-off.' },
    { id: uid(), projectId: p1, stakeholderId: s[21], support: 'Neutral', issueTags: 'Section 106,SHPO', addedDate: '2024-04-01', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Section 106 review.' },

    // SR-97 (p2)
    { id: uid(), projectId: p2, stakeholderId: s[8], support: 'Champion', issueTags: 'Construction,Schedule', addedDate: '2025-01-15', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'On-site RE.' },
    { id: uid(), projectId: p2, stakeholderId: s[9], support: 'Supportive', issueTags: 'Business access,Timeline', addedDate: '2025-01-20', distributionGroups: 'Elected officials', stakeholderRole: 'External', notes: 'Monthly briefing requested.' },
    { id: uid(), projectId: p2, stakeholderId: s[10], support: 'Neutral', issueTags: 'Business impact,Access,Night work', addedDate: '2025-01-25', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Chamber newsletter for 1,400 members.' },
    { id: uid(), projectId: p2, stakeholderId: s[11], support: 'Neutral', issueTags: 'Parking,Access', addedDate: '2025-02-01', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Avoid Sunday/Wednesday evening work windows.' },
    { id: uid(), projectId: p2, stakeholderId: s[12], support: 'Opponent', issueTags: 'Aesthetics,Visual impact', addedDate: '2025-02-05', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Requesting construction screening on Main St.' },
    { id: uid(), projectId: p2, stakeholderId: s[13], support: 'Neutral', issueTags: 'LEP,EJ,Access', addedDate: '2025-02-10', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'Spanish bilingual outreach. Distributed pre-con flyers.' },
    { id: uid(), projectId: p2, stakeholderId: s[18], support: 'Champion', issueTags: '', addedDate: '2025-01-15', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'PI lead.' },
    { id: uid(), projectId: p2, stakeholderId: s[20], support: 'Neutral', issueTags: 'Title VI,LEP', addedDate: '2025-02-01', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Title VI sign-off on public meeting.' },

    // Carbon County (p3)
    { id: uid(), projectId: p3, stakeholderId: s[14], support: 'Neutral', issueTags: 'Section 106,Tribal,Cultural resources', addedDate: '2023-11-15', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'Formal tribal consultation. High priority.' },
    { id: uid(), projectId: p3, stakeholderId: s[15], support: 'Champion', issueTags: 'Economic development,Access', addedDate: '2023-11-20', distributionGroups: 'Elected officials', stakeholderRole: 'External', notes: 'Strong local supporter.' },
    { id: uid(), projectId: p3, stakeholderId: s[16], support: 'Neutral', issueTags: 'Access,Delay', addedDate: '2023-12-01', distributionGroups: 'Elected officials', stakeholderRole: 'External', notes: 'Frustrated about project hold. Maintain contact.' },
    { id: uid(), projectId: p3, stakeholderId: s[17], support: 'Neutral', issueTags: 'EJ,Hispanic outreach', addedDate: '2024-01-10', distributionGroups: 'Community/Public', stakeholderRole: 'External', notes: 'EJ monitor. Engaged at scoping.' },
    { id: uid(), projectId: p3, stakeholderId: s[18], support: 'Champion', issueTags: '', addedDate: '2023-11-01', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'PI lead.' },
    { id: uid(), projectId: p3, stakeholderId: s[19], support: 'Champion', issueTags: 'NEPA,EA,Tribal', addedDate: '2023-11-01', distributionGroups: 'Project team', stakeholderRole: 'Internal', notes: 'EA author and tribal coordination.' },
    { id: uid(), projectId: p3, stakeholderId: s[21], support: 'Neutral', issueTags: 'Section 106,Cultural resources', addedDate: '2024-01-20', distributionGroups: 'Agency contacts', stakeholderRole: 'External', notes: 'SHPO Section 106 review in progress.' }
  ];

  // ── INTERACTIONS ──
  const newInteractions = [
    // US-89
    { id: uid(), projectId: p1, stakeholderId: s[4], date: '2025-01-10', channel: 'Email', direction: 'Outgoing', summary: 'Transmitted Draft EA to FHWA Utah Division for federal review. Document includes traffic, noise, air quality, and EJ technical analyses. 45-day review period initiated.', followUp: true, followUpNote: 'Follow up on FHWA review comments by February 24', followUpDue: '2025-02-24', followUpDone: false, loggedBy: 'A. Stratton' },
    { id: uid(), projectId: p1, stakeholderId: s[1], date: '2025-02-05', channel: 'Public meeting', direction: 'In-person', summary: 'Attended Tongan community meeting at Layton Pacific Islander Cultural Center with Peni Fifita. 42 community members present. Presented bilingual project fact sheet. Top concerns: noise during nighttime paving, pedestrian crossing safety at US-89/Gordon Ave, and air quality during construction. Tongan interpreter provided throughout.', followUp: true, followUpNote: 'Translate Q&A summary into Tongan and distribute via Taufa contact list', followUpDue: '2025-02-19', followUpDone: true, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p1, stakeholderId: s[6], date: '2025-02-12', channel: 'Email', direction: 'Incoming', summary: 'Allred submitted formal written noise wall ballot petition signed by 187 Layton Hills residents. Requests UDOT initiate noise barrier eligibility determination before Draft EA public comment period closes.', followUp: true, followUpNote: 'Forward to UDOT noise team for eligibility review. Respond to Allred in writing within 10 business days.', followUpDue: '2025-02-26', followUpDone: false, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p1, stakeholderId: s[2], date: '2025-03-03', channel: 'In-person', direction: 'In-person', summary: 'Pre-hearing briefing with Rep. Romero at the Capitol. Presented EJ analysis summary and LEP outreach metrics. Rep. Romero expressed support for Tongan-language outreach efforts and asked for final EJ findings before the public hearing.', followUp: true, followUpNote: 'Send final EJ summary to Rep. Romero office 2 weeks before public hearing', followUpDue: '2025-04-14', followUpDone: false, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p1, stakeholderId: s[3], date: '2025-03-18', channel: 'Phone', direction: 'Incoming', summary: 'Jensen called to flag conflict with Farmington City\'s planned water main replacement on 400 N US-89. Requesting coordination meeting to align construction schedules and avoid simultaneous utility conflicts.', followUp: true, followUpNote: 'Schedule joint coordination meeting with Farmington City Engineering and UDOT Region 1', followUpDue: '2025-04-01', followUpDone: true, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p1, stakeholderId: s[20], date: '2025-01-22', channel: 'Email', direction: 'Outgoing', summary: 'Submitted Title VI compliance checklist and LEP outreach summary for Draft EA public hearing to Tina Morales, UDOT Civil Rights. Includes documentation of Tongan-language materials and interpretation services arranged for community meeting on Feb 5.', followUp: false, followUpNote: '', followUpDue: '', followUpDone: false, loggedBy: 'J. Putzke' },

    // SR-97
    { id: uid(), projectId: p2, stakeholderId: s[10], date: '2025-04-14', channel: 'Email', direction: 'Outgoing', summary: 'Distributed April construction update to Springville Chamber distribution list (1,400 members). Included detour map, business access hotline number, and May/June lane closure schedule. Harrop confirmed receipt and plans to share in Chamber e-newsletter.', followUp: false, followUpNote: '', followUpDue: '', followUpDone: false, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p2, stakeholderId: s[9], date: '2025-05-06', channel: 'In-person', direction: 'In-person', summary: 'Monthly project briefing with Mayor Oyler and City Administrator. Presented construction progress, upcoming Phase 2 Main St closure dates, and public communication plan. Mayor requested that the city be notified 48 hours before any press releases about delays.', followUp: true, followUpNote: 'Add Mayor\'s office to 48-hour advance notification list for all delay announcements', followUpDue: '2025-05-09', followUpDone: true, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p2, stakeholderId: s[11], date: '2025-05-11', channel: 'Phone', direction: 'Outgoing', summary: 'Called Sister Petersen to confirm Phase 2 paving schedule. Confirmed no work on Sundays or Wednesday evenings 6–9 PM throughout Phase 2. Petersen expressed appreciation and offered parking lot as staging area during off-hours.', followUp: false, followUpNote: '', followUpDue: '', followUpDone: false, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p2, stakeholderId: s[12], date: '2025-05-20', channel: 'Email', direction: 'Incoming', summary: 'Vance emailed formal request for construction aesthetic screening on Main St frontage adjacent to the museum entrance. Attached examples of screening wraps used on other Utah DOT projects. Copied Mayor Oyler and Chamber director.', followUp: true, followUpNote: 'Review screening request with UDOT Region 3 RE and contractor. Respond to Vance within 5 days.', followUpDue: '2025-05-27', followUpDone: false, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p2, stakeholderId: s[13], date: '2025-04-07', channel: 'In-person', direction: 'In-person', summary: 'Pre-construction public open house at Springville High School. Contreras attended with 14 Spanish-speaking residents from the 400 South corridor. Spanish interpreter on site. Residents raised pedestrian safety concerns at 400 South crossing during construction. Comment cards collected (bilingual).', followUp: true, followUpNote: 'Prepare Spanish-language response to pedestrian safety comments. Distribute via Contreras.', followUpDue: '2025-04-21', followUpDone: true, loggedBy: 'J. Putzke' },

    // Carbon County
    { id: uid(), projectId: p3, stakeholderId: s[14], date: '2024-02-14', channel: 'Mail', direction: 'Outgoing', summary: 'Sent formal written tribal notification to Ute Indian Tribe THPO per UDOT 08A2-07 and Utah EO 2014/005. Letter describes project corridor, potential impacts to traditional cultural properties, and request for consultation. Certified mail, return receipt requested.', followUp: true, followUpNote: 'Follow up by March 14 if no response received (30-day deadline)', followUpDue: '2024-03-14', followUpDone: true, loggedBy: 'A. Stratton' },
    { id: uid(), projectId: p3, stakeholderId: s[14], date: '2024-03-20', channel: 'Phone', direction: 'Incoming', summary: 'Received call from Nathan Begay, THPO. Tribe acknowledges receipt of notification. Requests site visit and Phase I cultural resources survey results before formal consultation meeting. Two areas of concern: lower Price River canyon and a ridge above Helper city limits identified as traditional use area.', followUp: true, followUpNote: 'Schedule site visit with Begay. Confirm Phase I survey scope with Amy.', followUpDue: '2024-04-05', followUpDone: true, loggedBy: 'A. Stratton' },
    { id: uid(), projectId: p3, stakeholderId: s[16], date: '2024-06-03', channel: 'Phone', direction: 'Incoming', summary: 'Mayor Schofield called expressing frustration about project hold. Concerned Helper residents see no visible project activity. Requested a status letter he can share publicly and a community meeting before year-end even if project schedule hasn\'t advanced.', followUp: true, followUpNote: 'Draft project status letter for Helper City. Check with UDOT on authorized messaging during hold period.', followUpDue: '2024-06-17', followUpDone: true, loggedBy: 'J. Putzke' },
    { id: uid(), projectId: p3, stakeholderId: s[17], date: '2024-05-20', channel: 'Public meeting', direction: 'In-person', summary: 'NEPA scoping meeting at Carbon County Courthouse. Archuleta attended with 7 Helper residents. Voiced concerns about disproportionate construction impacts on lower-income Hispanic households near the Helper interchange. Submitted written comment requesting EJ analysis begin immediately.', followUp: true, followUpNote: 'Acknowledge written EJ comment in scoping report. Begin EJ demographic analysis.', followUpDue: '2024-06-10', followUpDone: true, loggedBy: 'J. Putzke' }
  ];

  // ── MEETINGS ──
  const newMeetings = [
    { id: uid(), projectId: p1, title: 'US-89 NEPA Scoping Meeting — Public', date: '2024-07-23', type: 'Public open house', location: 'Layton City Hall Council Chambers, 437 N Wasatch Dr, Layton, UT', status: 'Completed', attendanceCount: 134, commentCards: 52, format: 'In-person', handouts: 'Bilingual project fact sheet (English/Tongan), alternatives map, comment card', agenda: 'Present project need, alternatives, and environmental study process. Collect public input on preferred alternative and key concerns.', keyConcerns: 'Noise impacts on Layton Hills residential area. Tongan community concerns about pedestrian safety and air quality. Business owners requesting access maintenance during paving. Noise wall interest from 150+ households.', actionItems: 'Provide Tongan Q&A summary to Marcus Taufa\nInitiate noise barrier eligibility study for Layton Hills segment\nDistribute scoping comment summary within 60 days', attendeeIds: [], notes: 'Tongan interpreter provided. Spanish materials available. Mayor Cragun gave opening remarks. Strong turnout exceeded room capacity — overflow standing room.', createdAt: '2024-07-23T18:00:00.000Z' },
    { id: uid(), projectId: p1, title: 'US-89 Draft EA Public Hearing', date: '2025-04-28', type: 'Public hearing', location: 'Layton Community Center, 465 N Wasatch Dr, Layton, UT', status: 'Planned', attendanceCount: 0, commentCards: 0, format: 'In-person + Virtual hybrid', handouts: 'Draft EA executive summary, alternatives comparison, noise study summary, EJ analysis, Tongan fact sheet', agenda: 'Present Draft EA findings. Accept formal oral and written comments for the record. Court reporter on-site.', keyConcerns: '', actionItems: 'Confirm Tongan/Spanish interpreters\nNotify Rep. Romero 2 weeks in advance\nSubmit Title VI pre-meeting checklist to Tina Morales', attendeeIds: [], notes: 'Scheduled per NEPA requirement. 30-day comment period closes May 28.', createdAt: '2025-01-15T09:00:00.000Z' },
    { id: uid(), projectId: p2, title: 'SR-97 Pre-Construction Public Open House', date: '2025-04-07', type: 'Public open house', location: 'Springville High School Commons, 545 S 200 E, Springville, UT', status: 'Completed', attendanceCount: 89, commentCards: 31, format: 'In-person', handouts: 'Construction schedule, detour map, business access plan, bilingual Spanish/English fact sheet', agenda: 'Introduce project team, present construction timeline and phasing, explain traffic management plan, Q&A', keyConcerns: 'Business access on Main St during Phase 2 closure. Pedestrian safety at 400 South during construction. Construction hours sensitivity for LDS Chapel and Springville Museum. Aesthetic screening request from Art Museum.', actionItems: 'Distribute business access hotline to Chamber\nPrepare Spanish-language response to pedestrian safety comments\nFollow up with Museum on screening options', attendeeIds: [], notes: 'Spanish interpreter on site. Bilingual comment cards collected. Strong business community attendance. Mayor Oyler gave opening welcome.', createdAt: '2025-04-07T17:30:00.000Z' },
    { id: uid(), projectId: p3, title: 'I-15 Carbon County Access Study — NEPA Scoping Meeting', date: '2024-05-20', type: 'Public open house', location: 'Carbon County Courthouse, 120 E Main St, Price, UT', status: 'Completed', attendanceCount: 47, commentCards: 19, format: 'In-person', handouts: 'Study purpose & need summary, project area map, comment card, EJ fact sheet', agenda: 'Present study purpose, scope, and NEPA process. Solicit input on community priorities and potential alternatives.', keyConcerns: 'Local economic development vs. environmental impacts in Price River corridor. EJ concerns from Helper residents. Tribal cultural resource concerns noted by Ute Indian Tribe representative (written comment submitted separately). Access timing and funding timeline uncertainty.', actionItems: 'Acknowledge EJ comment in scoping report\nInitiate EJ demographic analysis for Helper area\nBegin Phase I cultural resources survey coordination with SHPO and Ute Tribe', attendeeIds: [], notes: 'Attendee mix included county officials, Helper and Wellington residents, Carbon County Business Alliance, and Archuleta coalition members. Project on hold announced at meeting end — disappointment noted.', createdAt: '2024-05-20T17:00:00.000Z' }
  ];

  // ── PUBLIC COMMENT PERIODS ──
  const cp1 = uid(), cp2 = uid();
  const newPeriods = [
    { id: cp1, projectId: p1, title: 'US-89 Draft EA Public Comment Period', startDate: '2025-04-28', endDate: '2025-05-28', status: 'Open', description: '30-day public comment period following the Draft EA Public Hearing. All comments received by 5:00 PM on May 28 will be addressed in the Final EA.' },
    { id: cp2, projectId: p2, title: 'SR-97 Pre-Construction Public Comment Period', startDate: '2025-04-07', endDate: '2025-04-21', status: 'Closed', description: 'Two-week comment collection period following the pre-construction open house. Comments will be compiled into the project PI record.' }
  ];

  // ── PUBLIC COMMENTS ──
  const newComments = [
    // US-89 (cp1) — open period
    { id: uid(), projectId: p1, periodId: cp1, commentDate: '2025-04-28', commentType: 'Written', commenter: 'Troy Allred', affiliation: 'Layton Hills Neighborhood Alliance', channel: 'Public hearing', summary: 'Formal comment requesting UDOT complete the noise barrier eligibility determination before the close of the public comment period and include results in the Final EA.', category: 'Noise / vibration', sentiment: 'Negative', responseStatus: 'Pending', responseText: '', responseDate: '', linkedStakeholderId: s[6] },
    { id: uid(), projectId: p1, periodId: cp1, commentDate: '2025-04-28', commentType: 'Oral (transcript)', commenter: 'Marcus Taufa', affiliation: 'South Layton Tongan Community Association', channel: 'Public hearing', summary: 'Appreciates the Tongan-language materials and interpreter at all outreach events. Requests that UDOT commit to continuing Tongan-language notifications throughout construction. Also requests a pedestrian crossing improvement at US-89/Gordon Ave be studied.', category: 'Language access / LEP', sentiment: 'Neutral', responseStatus: 'In progress', responseText: '', responseDate: '', linkedStakeholderId: s[1] },
    { id: uid(), projectId: p1, periodId: cp1, commentDate: '2025-04-29', commentType: 'Online', commenter: 'Cheryl Nakashima', affiliation: 'Davis County Health Department', channel: 'Online comment form', summary: 'Davis County Health requests that the Final EA include a quantitative air quality analysis for PM2.5 during construction near the South Layton residential clusters, with particular attention to Environmental Justice populations.', category: 'Air quality', sentiment: 'Neutral', responseStatus: 'Pending', responseText: '', responseDate: '', linkedStakeholderId: s[5] },
    { id: uid(), projectId: p1, periodId: cp1, commentDate: '2025-04-30', commentType: 'Online', commenter: 'Peni Fifita', affiliation: 'Layton Pacific Islander Health Coalition', channel: 'Online comment form', summary: 'Requests that all construction-phase notifications be sent in both English and Tongan. Offers to serve as a community liaison to Tongan residents during construction phase.', category: 'Language access / LEP', sentiment: 'Positive', responseStatus: 'Pending', responseText: '', responseDate: '', linkedStakeholderId: s[7] },
    { id: uid(), projectId: p1, periodId: cp1, commentDate: '2025-05-02', commentType: 'Written', commenter: 'Diana Lucero', affiliation: 'FHWA Utah Division', channel: 'Mail', summary: 'FHWA comments on Draft EA: (1) EJ section should reference specific demographic census data; (2) LEP plan must comply with updated 2024 Executive Order guidance; (3) Draft Section 4(f) evaluation needs additional detail for the park parcel at Station 88+40.', category: 'NEPA / regulatory', sentiment: 'Neutral', responseStatus: 'In progress', responseText: '', responseDate: '', linkedStakeholderId: s[4] },

    // SR-97 (cp2) — closed
    { id: uid(), projectId: p2, periodId: cp2, commentDate: '2025-04-07', commentType: 'Written', commenter: 'Lori Vance', affiliation: 'Springville Art Museum', channel: 'Public meeting', summary: 'Formal written request for aesthetic construction screening on the Main Street frontage of the museum during Phase 2 construction. Includes photos of preferred screening wrap examples used on other UDOT projects.', category: 'Aesthetics / visual', sentiment: 'Negative', responseStatus: 'Responded', responseText: 'After review with UDOT Region 3 and the contractor, UDOT has agreed to install 8-foot printed vinyl construction screening on the Main Street frontage of the museum during Phase 2 work. Screening design will incorporate the Art City theme. Installation scheduled for May 12, 2025.', responseDate: '2025-04-25', linkedStakeholderId: s[12] },
    { id: uid(), projectId: p2, periodId: cp2, commentDate: '2025-04-07', commentType: 'Oral (transcript)', commenter: 'Community Member', affiliation: 'Springville Resident', channel: 'Public meeting', summary: 'Resident at 450 South expressed concern about dust and noise during Phase 2 paving. Asked whether construction would occur on weekends.', category: 'Noise / vibration', sentiment: 'Negative', responseStatus: 'Responded', responseText: 'Phase 2 paving will occur Monday through Saturday, 7:00 AM to 9:00 PM. No Sunday work is planned. UDOT will provide advance notice flyers to adjacent residents before Phase 2 begins. A dust control plan is in place including watering of exposed soil.', responseDate: '2025-04-18', linkedStakeholderId: null },
    { id: uid(), projectId: p2, periodId: cp2, commentDate: '2025-04-08', commentType: 'Online', commenter: 'Jorge Contreras', affiliation: 'Centro Hispano Comunitario de Utah Valley', channel: 'Online comment form', summary: 'Solicita que los avisos de construcción se envíen en español a los residentes de 400 South. Los residentes hispanohablantes no leyeron el aviso en inglés. (Requests that construction notifications be sent in Spanish to 400 South residents. Spanish-speaking residents did not read the English-only notice.)', category: 'Language access / LEP', sentiment: 'Negative', responseStatus: 'Responded', responseText: 'UDOT Region 3 will add Spanish-language notification to the construction update distribution. All future flyers and door hangers in the 400 South corridor will be bilingual. Spanish comment card responses will be prepared and distributed via Centro Hispano within two weeks.', responseDate: '2025-04-21', linkedStakeholderId: s[13] },
    { id: uid(), projectId: p2, periodId: cp2, commentDate: '2025-04-10', commentType: 'Written', commenter: 'Glen Harrop', affiliation: 'Springville Art City Chamber of Commerce', channel: 'Mail', summary: 'Chamber formally requests UDOT limit Phase 2 Main Street construction to off-peak hours (8 PM – 6 AM) to minimize business disruption during the summer season. Notes that July and August are peak revenue months for downtown businesses.', category: 'Business impact', sentiment: 'Negative', responseStatus: 'Responded', responseText: 'After evaluation with the construction team, UDOT is unable to shift to exclusively overnight work due to noise ordinance constraints and contractor crew availability. However, the most disruptive activities (saw cutting, asphalt removal) will be scheduled during lower-traffic hours where feasible. UDOT commits to a 72-hour advance notification to Chamber members before any full road closure.', responseDate: '2025-04-28', linkedStakeholderId: s[10] }
  ];

  // ── DELIVERABLES ──
  const newDeliverables = [
    { id: uid(), projectId: p1, type: 'PI summary report', title: 'Bi-monthly PI progress reports — US-89 EA phase', scopeType: 'recurring', freq: 'Bi-monthly', contractedQty: 8, deliveredCount: 3, status: 'In progress', progress: 38, milestoneStart: 'Notice to Proceed', milestoneEnd: 'FONSI', distList: 'B. Whitmore (UDOT R1), D. Lucero (FHWA), T. Morales (UDOT CR)', notes: 'Reports 1–3 delivered. Report 4 due June 15.' },
    { id: uid(), projectId: p1, type: 'Public meeting', title: 'NEPA scoping public meeting', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Scoping initiation', milestoneEnd: '', distList: '', notes: 'Completed July 23, 2024. 134 attendees, Tongan/Spanish interpretation.' },
    { id: uid(), projectId: p1, type: 'Public meeting', title: 'Draft EA public hearing', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 0, status: 'In progress', progress: 60, milestoneStart: 'Draft EA circulation', milestoneEnd: '', distList: '', notes: 'Hearing date April 28, 2025. Logistics in progress.' },
    { id: uid(), projectId: p1, type: 'Notification flyer', title: 'NEPA scoping notice (bilingual)', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Scoping initiation', milestoneEnd: '', distList: '4,200 adjacent property owners, Davis County records', notes: 'English/Tongan bilingual. Mailed 18 days prior to scoping meeting.' },
    { id: uid(), projectId: p1, type: 'Digital newsletter', title: 'US-89 project update (bilingual)', scopeType: 'fixed', freq: '', contractedQty: 4, deliveredCount: 2, status: 'In progress', progress: 50, milestoneStart: '', milestoneEnd: '', distList: '6,800 email subscribers, Tongan community list', notes: 'Issues 1 and 2 distributed. Issue 3 timed for Draft EA public hearing.' },
    { id: uid(), projectId: p1, type: 'EJ outreach documentation', title: 'LEP/EJ outreach documentation — Title VI compliance record', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 0, status: 'In progress', progress: 70, milestoneStart: 'Draft EA', milestoneEnd: '', distList: 'T. Morales, D. Lucero', notes: 'Documenting all Tongan and LEP outreach activities per Title VI requirements.' },
    { id: uid(), projectId: p2, type: 'Public meeting', title: 'Pre-construction public open house', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Precon meeting', milestoneEnd: '', distList: '', notes: '89 attendees. Spanish interpreter provided. April 7, 2025.' },
    { id: uid(), projectId: p2, type: 'Notification flyer', title: 'Pre-construction notice (bilingual)', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Precon meeting', milestoneEnd: '', distList: '1,640 adjacent property and business owners', notes: 'English/Spanish bilingual. Door-to-door distribution via Centro Hispano for 400 South segment.' },
    { id: uid(), projectId: p2, type: 'PI summary report', title: 'Monthly PI construction summary', scopeType: 'recurring', freq: 'Monthly', contractedQty: 12, deliveredCount: 2, status: 'In progress', progress: 17, milestoneStart: 'Construction start', milestoneEnd: 'Construction complete', distList: 'R. Aagard (RE), UDOT R3 PM, Mayor Oyler office', notes: 'Began April 2025. Includes business access hotline volume, community contact log, and complaint tracking.' },
    { id: uid(), projectId: p2, type: 'Comment response matrix', title: 'Public comment response matrix', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Comment period close', milestoneEnd: '', distList: '', notes: '9 comments received. All responded. Matrix filed in PI record.' },
    { id: uid(), projectId: p3, type: 'Public meeting', title: 'NEPA scoping meeting — Price/Carbon County', scopeType: 'milestone', freq: '', contractedQty: 2, deliveredCount: 1, status: 'In progress', progress: 50, milestoneStart: 'Scoping initiation', milestoneEnd: '', distList: '', notes: 'First scoping meeting completed May 20, 2024. Second meeting on hold pending funding authorization.' },
    { id: uid(), projectId: p3, type: 'Notification flyer', title: 'NEPA scoping notice', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 1, status: 'Complete', progress: 100, milestoneStart: 'Scoping initiation', milestoneEnd: '', distList: '1,100 Carbon and Emery County addresses', notes: 'Mailed 21 days prior to scoping meeting.' },
    { id: uid(), projectId: p3, type: 'Section 106 / tribal consultation record', title: 'Ute Indian Tribe Section 106 consultation record', scopeType: 'milestone', freq: '', contractedQty: 1, deliveredCount: 0, status: 'In progress', progress: 35, milestoneStart: 'NEPA initiation', milestoneEnd: '', distList: 'N. Begay (THPO), SHPO, UDOT EPM', notes: 'Initial notification sent. Site visit completed. Formal consultation meeting pending restart of project.' }
  ];

  // ── WRITE TO SUPABASE ──
  // Projects and stakeholders use Supabase auto-increment integer PKs.
  // We must insert them first, capture the real IDs, then remap all
  // foreign keys before inserting dependent records.
  if (typeof sbAdd !== 'function') {
    console.error('sbAdd not found — is the COMPASS app loaded?');
    return;
  }

  console.log('Inserting projects...');
  const projIdMap = {}; // temp uid → real Supabase id
  for (const proj of newProjects) {
    const realId = await sbAdd('projects', proj);
    if (realId) projIdMap[proj.id] = realId;
    else console.warn('Failed to insert project', proj.pid);
  }
  console.log('Project ID map:', projIdMap);

  console.log('Inserting stakeholders...');
  const stakeIdMap = {}; // temp uid → real Supabase id
  for (const stake of newStakeholders) {
    const realId = await sbAdd('stakeholders', stake);
    if (realId) stakeIdMap[stake.id] = realId;
    else console.warn('Failed to insert stakeholder', stake.firstName, stake.lastName);
  }
  console.log('Stakeholder ID map:', stakeIdMap);

  // Remap foreign keys in all dependent records
  const remap = id => projIdMap[id] || stakeIdMap[id] || id;

  const remapPS = newPS.map(r => ({...r,
    projectId:     projIdMap[r.projectId]     || r.projectId,
    stakeholderId: stakeIdMap[r.stakeholderId] || r.stakeholderId
  }));
  const remapInts = newInteractions.map(r => ({...r,
    projectId:     projIdMap[r.projectId]     || r.projectId,
    stakeholderId: stakeIdMap[r.stakeholderId] || r.stakeholderId
  }));
  const remapMeetings = newMeetings.map(r => ({...r,
    projectId: projIdMap[r.projectId] || r.projectId
  }));
  const remapPeriods = newPeriods.map(r => ({...r,
    projectId: projIdMap[r.projectId] || r.projectId
  }));
  const remapComments = newComments.map(r => ({...r,
    projectId:           projIdMap[r.projectId] || r.projectId,
    // periodId stays as text (pi_comment_periods uses text PKs)
    linkedStakeholderId: r.linkedStakeholderId ? (stakeIdMap[r.linkedStakeholderId] || r.linkedStakeholderId) : null
  }));
  const remapDeliverables = newDeliverables.map(r => ({...r,
    projectId: projIdMap[r.projectId] || r.projectId
  }));

  console.log('Inserting project-stakeholder links...');
  await Promise.all(remapPS.map(r => sbAdd('project_stakeholders', r)));

  console.log('Inserting interactions...');
  await Promise.all(remapInts.map(r => sbAdd('interactions', r)));

  console.log('Inserting meetings...');
  await Promise.all(remapMeetings.map(r => sbAdd('meetings', r)));

  console.log('Inserting comment periods...');
  await Promise.all(remapPeriods.map(r => sbAdd('comment_periods', r)));

  console.log('Inserting public comments...');
  await Promise.all(remapComments.map(r => sbAdd('public_comments', r)));

  console.log('Inserting deliverables...');
  await Promise.all(remapDeliverables.map(r => sbAdd('deliverables', r)));

  // Reload all data from Supabase so _syncCache has canonical IDs
  console.log('Reloading from Supabase...');
  await loadAllData();

  // Trigger UI refresh
  if (typeof render === 'function') render();
  if (typeof refreshBadges === 'function') refreshBadges();

  console.log(`
✅ SEED COMPLETE
───────────────────────────────────────────────
Projects:       3 (PIDs 20001, 20002, 20003)
Stakeholders:   22
Project links:  ${newPS.length}
Interactions:   ${newInteractions.length}
Meetings:       ${newMeetings.length}
Comment periods: 2
Public comments: ${newComments.length}
Deliverables:   ${newDeliverables.length}
───────────────────────────────────────────────
Projects:
  20001 — US-89 Farmington to Layton (EA, Active)
  20002 — SR-97 Springville Main St (CE, Active, Construction)
  20003 — I-15 Carbon County Access Study (EA, On Hold)
  `);
})();
