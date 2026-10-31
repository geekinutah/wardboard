# General Handbook Calling Gender Requirements

**Reference Guide for WardBoard Data Model and Calling Assignment Validation (B-068)**  
**Source of Truth:** *General Handbook: Serving in The Church of Jesus Christ of Latter-day Saints* (ChurchofJesusChrist.org, current edition as of 2026), specifically Section 30.8.1 ("Chart of Callings — Ward Callings") and organization-specific chapters (7–14, 19, 20, 22, 23, 25, 33, 34, 35, 38).  
**Repository Context:** Cross-referenced against `fixtures/lcr-reports/organizations-and-callings.pdf`, `apps/server/src/import/roles.ts`, `packages/core/src/fixtures/ward.ts`, and backlog item `docs/tasks/backlog/B-068-member-gender.md`.

---

## 1. Executive Summary & Core Rules

In The Church of Jesus Christ of Latter-day Saints, ward callings fall into four structural gender categories:

1. **Male Only (`M`)**  
   Callings that require ordination to a specific priesthood office (High Priest, Elder, Priest, Teacher, or Deacon), general Melchizedek/Aaronic Priesthood ordination, or membership in a male priesthood quorum (Elders Quorum or Aaronic Priesthood Quorums).
   - *Examples:* Bishop, Bishopric Counselors, Ward Clerk, Assistant Ward Clerks, Executive Secretary, Elders Quorum Presidency and all Quorum staff, Aaronic Priesthood Quorum Presidencies and Advisers/Specialists, Ward Mission Leader, Ward Temple and Family History Leader.

2. **Female Only (`F`)**  
   Callings that require membership in Relief Society or Young Women, or specific female leadership callings designated in the Handbook.
   - *Examples:* Relief Society Presidency and all staff/teachers/coordinators, Young Women Presidency, Secretaries, Advisers, Specialists, and Class Presidencies, Primary Presidency (President and Counselors) and Primary Secretary.

3. **Either / Open to Men or Women (`Any`)**  
   Callings with no gender restriction. These can be filled by an adult man, adult woman, married couple, or in some instances youth or non-members (e.g., musical accompaniment).
   - *Examples:* Primary Teachers and Nursery Leaders, Primary Music Leader and Pianist, Sunday School Teachers, Sunday School Resource Center Specialist, Ward Missionaries, Ward Temple & Family History Consultants, Ward Music Coordinator, Sacrament and Choir Directors/Accompanists, Ward Activities Committee, Welfare and Self-Reliance Specialists, History Specialist, Technology Specialist, Building Representative, Disability Specialist, Interpreters.

4. **Contingent / Dynamic Matching (`Contingent`)**  
   Callings where the gender requirement depends dynamically on another calling assignment:
   - **Sunday School Presidency & Secretary (Handbook 13.2.2.1):** Under current General Handbook instructions, a **woman or a man** may be called as Ward Sunday School President (if a man, he must hold the Melchizedek Priesthood). However, **counselors and the secretary must be the same gender as the president**. Thus:
     - If Sunday School President is **Male**, Counselors and Secretary must be **Male** (`M`).
     - If Sunday School President is **Female**, Counselors and Secretary must be **Female** (`F`).

---

## 2. Complete General Handbook Chart of Callings (Section 30.8.1)

The following table details every standard ward calling defined in **General Handbook Section 30.8.1 ("Ward Callings")**, correlated with its governing Handbook chapter, priesthood/age requisites, and gender constraint.

| Handbook Calling Title | Governing Handbook Section | Gender Rule | Priesthood / Office Requisites | Age / Status Requisites | Sustaining & Setting Apart Authority |
|---|---|:---:|---|---|---|
| **Bishop** | 7.1, 30.8.1 | `M` | High Priest | Adult male; worthy, temple recommend | Stake President (First Presidency approval) |
| **Counselors in the Bishopric** | 7.1, 30.8.1 | `M` | High Priest | Adult male; worthy, temple recommend | Stake President or assigned Counselor |
| **Ward Clerk** | 7.4, 33.4.2, 30.8.1 | `M` | Melchizedek Priesthood | Adult male; temple recommend | Stake President, Counselor, or High Councilor |
| **Assistant Ward Clerks** | 7.4, 33.4.3, 30.8.1 | `M` | Melchizedek or Aaronic Priesthood (*Finance requires Melchizedek*) | Male; temple recommend | Stake President, Counselor, or High Councilor |
| **Ward Executive Secretary** | 7.3, 30.8.1 | `M` | Melchizedek Priesthood | Adult male; temple recommend | Stake President, Counselor, or High Councilor |
| **Assistant Ward Executive Secretaries** | 7.3, 30.8.1 | `M` | Melchizedek Priesthood | Adult male; temple recommend | Stake President, Counselor, or High Councilor |
| **Elders Quorum President** | 8.3.3.1, 30.8.1 | `M` | Melchizedek Priesthood (Elder or High Priest) | Adult male | Stake President |
| **Counselors in Elders Quorum Presidency** | 8.3.3.1, 30.8.1 | `M` | Melchizedek Priesthood (Elder or High Priest) | Adult male | Stake President, Counselor, or High Councilor |
| **Elders Quorum Secretary** | 8.3.4, 30.8.1 | `M` | Melchizedek Priesthood / Quorum Member | Adult male | Quorum President or assigned Counselor |
| **Other Elders Quorum Callings** (Teachers, Service/Activity Coordinators, Assistants, Ministering Sec.) | 8.3.5, 30.8.1 | `M` | Quorum Members (Brethren) | Adult male | Quorum President or assigned Counselor |
| **Relief Society President** | 9.3.2.1, 30.8.1 | `F` | None | Adult female (Relief Society member) | Bishop |
| **Counselors in Relief Society Presidency** | 9.3.2.1, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Relief Society Secretary** | 9.3.3, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Other Relief Society Callings** (Teachers, Service/Activity Coordinators, Ministering Sec., Committees) | 9.3.4, 30.8.1 | `F` | None | Adult female (Sisters) | Bishop or assigned Counselor |
| **Young Women President** | 11.3.2, 30.8.1 | `F` | None | Adult female | Bishop |
| **Counselors in Young Women Presidency** | 11.3.2, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Young Women Secretary** | 11.3.3, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Young Women Advisers** | 11.3.5, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Young Women Specialists** (Camp, Sports, Activities) | 11.3.6, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Young Women Age-Group Presidents** | 11.3.4.1, 30.8.1 | `F` | None | Female youth in age class (ages 11–18) | Bishop or assigned Counselor |
| **Counselors & Secretaries in YW Age-Group Presidencies** | 11.3.4.1, 30.8.1 | `F` | None | Female youth in age class (ages 11–18) | Bishop or assigned Counselor |
| **Priests Quorum President** | 7.1.2, 10.3, 30.8.1 | `M` | Bishop (Presiding High Priest) | Adult male (Bishop) | Stake President |
| **Assistants to the Priests Quorum President** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Priest) | Male youth (Priest, typically ages 15–18) | Bishop |
| **Priests Quorum Secretary** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Priest) | Male youth (Priest) | Bishop or assigned Counselor |
| **Teachers Quorum President** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Teacher) | Male youth (Teacher, typically ages 14–15) | Called by Bishopric; set apart by Bishop |
| **Counselors & Secretary in Teachers Quorum** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Teacher) | Male youth (Teacher) | Bishop or assigned Counselor |
| **Deacons Quorum President** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Deacon) | Male youth (Deacon, typically ages 11–13) | Called by Bishopric; set apart by Bishop |
| **Counselors & Secretary in Deacons Quorum** | 10.4.1, 30.8.1 | `M` | Aaronic Priesthood (Deacon) | Male youth (Deacon) | Bishop or assigned Counselor |
| **Aaronic Priesthood Quorum Advisers** | 10.5, 30.8.1 | `M` | Melchizedek Priesthood | Adult male | Bishop or assigned Counselor |
| **Aaronic Priesthood Quorum Specialists** (Camp, Sports) | 10.5, 30.8.1 | `M` | Melchizedek or Aaronic Priesthood | Adult male | Bishop or assigned Counselor |
| **Primary President** | 12.3.2, 30.8.1 | `F` | None | Adult female | Bishop |
| **Counselors in Primary Presidency** | 12.3.2, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Primary Secretary** | 12.3.3, 30.8.1 | `F` | None | Adult female | Bishop or assigned Counselor |
| **Primary Music Leader** | 12.3.4, 12.5.3, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Primary Pianist / Accompanist** | 12.3.4, 12.5.3, 30.8.1 | `Any` | None | Male, female, or youth | Bishop or assigned Counselor |
| **Primary Teachers** | 12.3.5, 12.5.3, 30.8.1 | `Any` | None | Adult male or female (*Youth not permitted*) | Bishop or assigned Counselor |
| **Nursery Leaders** | 12.3.5, 12.5.3, 30.8.1 | `Any` | None | Adult male, female, or married couple | Bishop or assigned Counselor |
| **Valiant Activity Leaders** (Boys & Girls) | 12.3.6, 12.5.3, 30.8.1 | `Any` | None | Adult male, female, or married couple | Bishop or assigned Counselor |
| **Sunday School President** | 13.2.2.1, 30.8.1 | `Any`* | If male, Melchizedek Priesthood | Adult male or adult female | Bishop |
| **Counselors in Sunday School Presidency** | 13.2.2.1, 30.8.1 | `Contingent`* | If male, priesthood not strictly required | Adult; **must match President's gender** | Bishop or assigned Counselor |
| **Sunday School Secretary** | 13.2.2.1, 30.8.1 | `Contingent`* | If male, priesthood not strictly required | Adult; **must match President's gender** | Bishop or assigned Counselor |
| **Sunday School Teachers** (Adult & Youth) | 13.2.3, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Ward Resource Center Specialist** (and Assistants) | 13.2.5, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Ward Mission Leader** | 23.6.3, 30.8.1 | `M` | Melchizedek Priesthood (or EQ presidency member) | Adult male | Bishop or assigned Counselor |
| **Assistant Ward Mission Leader** | 23.6.3, 30.8.1 | `M` | Melchizedek Priesthood | Adult male | Bishop or assigned Counselor |
| **Ward Missionaries** | 23.6.4, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Ward Temple and Family History Leader** | 25.2.3, 30.8.1 | `M` | Melchizedek Priesthood (or EQ presidency member) | Adult male | Bishop or assigned Counselor |
| **Ward Temple and Family History Consultants** | 25.2.4, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Ward Music Coordinator** | 19.4.2, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Ward Music Leader** | 19.4.3.1, 30.8.1 | `Any` | None | Male, female, or youth (members or other faiths) | Bishop or assigned Counselor |
| **Ward Accompanist / Pianist / Organist** | 19.4.3.2, 30.8.1 | `Any` | None | Male, female, or youth (members or other faiths) | Bishop or assigned Counselor |
| **Choir Director & Choir Accompanist** | 19.4.3.3, 30.8.1 | `Any` | None | Male, female, or youth (members or other faiths) | Bishop or assigned Counselor |
| **Priesthood Music Director / Pianist** | 19.4.3, 30.8.1 | `M` / `Any` | Typically Aaronic/Melchizedek Priesthood or accompanist | Male (director); accompanist may be either | Quorum / Bishopric |
| **Young Single Adult Leaders / Advisers** | 14.1.2.3, 30.8.1 | `Any` | None | Adult male, female, or married couple | Bishop or assigned Counselor |
| **Ward Activities Committee Chair & Members** | 20.2.1, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Ward Welfare & Self-Reliance Specialists** | 22.6.4, 30.8.1 | `Any` | None | Adult male, female, or married couple | Bishop or assigned Counselor |
| **Self-Reliance Group Facilitators** | 22.6.4, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Ward Building Representative** | 35.2.9, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Ward History Specialist** | 33.7.1, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Ward Technology Specialist** | 33.10, 30.8.1 | `Any` | None | Adult male, female, or youth | Bishop or assigned Counselor |
| **Interpreters** (Sign Language / Languages) | 38.8.28.6, 30.8.1 | `Any` | None | Male, female, or youth | Bishop or assigned Counselor |
| **Ward Disability Specialist & Activity Leaders** | 38.8.28.8–9, 30.8.1 | `Any` | None | Adult male or female | Bishop or assigned Counselor |
| **Other Ward Callings / Custom Callings** | 30.8.1 | `Any` | Case by case | Male or female as designated by Bishopric | Bishop or assigned Counselor |

---

## 3. Chapter-by-Chapter Handbook Analysis

### Chapter 7 & 33: The Bishopric, Executive Secretary, and Clerks
- **Bishop and Counselors (7.1):** Must be ordained **High Priests**. Limited strictly to adult men (`M`). If not already High Priests, they must be ordained before being set apart.
- **Ward Executive Secretary & Assistants (7.3):** The Handbook specifies the bishopric recommends a "Melchizedek Priesthood holder" (`M`) who holds a current temple recommend.
- **Ward Clerk (7.4, 33.4.2):** Must be a "Melchizedek Priesthood holder" (`M`) who holds a current temple recommend.
- **Assistant Ward Clerks (33.4.3):** "These brethren should hold the Melchizedek or Aaronic Priesthood. They should also have a current temple recommend. If an assistant ward clerk is assigned to finances, he should hold the Melchizedek Priesthood." (`M`).

### Chapter 8: Elders Quorum
- **Presidency (8.3.3.1):** The Elders Quorum President and Counselors must be Elders or High Priests (`M`).
- **Secretary (8.3.4):** Must be a "quorum member" (`M`).
- **Additional Callings (8.3.5):** Teachers, service coordinators, activity coordinators, assistants, committee members, and ministering secretaries are all explicitly recommended from "brethren" of the quorum (`M`).

### Chapter 9: Relief Society
- **Presidency (9.3.2.1):** The Relief Society President and Counselors must be adult women (`F`).
- **Secretary (9.3.3):** Must be an adult sister (`F`).
- **Additional Callings (9.3.4):** Teachers, service coordinators, activity coordinators, assistants, committee members, ministering secretaries, and compassionate service coordinators are explicitly recommended from "sisters" (`F`).

### Chapter 10: Aaronic Priesthood Quorums
- **Bishopric Presidency of Aaronic Priesthood (10.3):** Bishop presides over the Priests; 1st Counselor over Teachers; 2nd Counselor over Deacons (`M`).
- **Youth Quorum Presidencies (10.4.1):** 
  - Priests Quorum: Bishop is president; assistants and secretary are Priests (`M`).
  - Teachers Quorum: President, counselors, and secretary are Teachers (`M`).
  - Deacons Quorum: President, counselors, and secretary are Deacons (`M`).
- **Advisers and Specialists (10.5):** "A member of the bishopric calls and sets apart men to be Aaronic Priesthood quorum advisers... At least two responsible adult men should be present at each quorum meeting and activity." (`M`).

### Chapter 11: Young Women
- **Adult Presidency & Secretary (11.3.2, 11.3.3):** Must be adult women (`F`).
- **Youth Age-Group Presidencies (11.3.4):** Age-group presidents, counselors, and secretaries are young women members of the respective class (`F`).
- **Advisers and Specialists (11.3.5, 11.3.6):** Must be adult women (`F`). "At least two responsible adult women should be present at each meeting and activity."

### Chapter 12: Primary (Critical Split Organization)
Primary contains a stark operational split between its presidency and its operational teaching/music staff:
- **Presidency and Secretary (12.3.2, 12.3.3):** Strictly adult women (`F`).
- **Teachers and Nursery Leaders (12.3.5, 12.5.3):** Open to **men or women**, as well as married couples (`Any`). Youth may not teach or substitute in Primary.
- **Music Leaders and Pianists (12.3.4, 12.5.3):** Open to **men or women**, or youth (`Any`).
- **Valiant Activity Leaders (12.3.6, 12.5.3):** Open to **men or women**, or married couples (`Any`). Both Boys and Girls activity groups can be led by men, women, or couples.
- **Section 12.5.3 ("Men Serving in Primary"):** Explicitly instructs: *"The bishopric and Primary presidency should remember the positive influence of worthy men serving in Primary. Men may serve as teachers, nursery leaders, music leaders and pianists, and Valiant activity leaders."*

### Chapter 13: Sunday School (Dynamic Gender Alignment)
- **Sunday School President (13.2.2.1):** 
  > *"The bishop calls and sets apart the ward Sunday School president. A woman or a man may be called. A man serving as Sunday School president must hold the Melchizedek Priesthood."*
- **Sunday School Counselors (13.2.2.1):** 
  > *"The counselors must be the same gender as the president. Male counselors do not need to be Melchizedek Priesthood holders."*
- **Sunday School Secretary (13.2.2.1):** 
  > *"The secretary must be the same gender as the president and counselors. A male secretary does not need to be a Melchizedek Priesthood holder."*
- **Sunday School Teachers (13.2.3):** Adult men and women may serve (`Any`).
- **Resource Center Specialist (13.2.5):** Men, women, or youth may serve (`Any`).

### Chapter 23 & 25: Missionary and Temple & Family History
Both of these organizations feature a Melchizedek Priesthood leader overseeing coed workers:
- **Ward Mission Leader (23.6.3):** Must be a Melchizedek Priesthood holder (`M`), or an assigned member of the Elders Quorum presidency.
- **Ward Missionaries (23.6.4):** Open to men, women, and youth (`Any`).
- **Ward Temple & Family History Leader (25.2.3):** Must be a Melchizedek Priesthood holder (`M`), or an assigned member of the Elders Quorum presidency.
- **Ward Temple & Family History Consultants (25.2.4):** Open to adult men, adult women, and youth (`Any`).

### Chapters 14, 19, 20, 22, 33, 35, 38: Ward-Wide Specialized Roles
- **Music (19.4.2–3):** Ward Music Coordinator, Music Leader, Accompanist/Organist, Choir Director, Choir Accompanist are open to men, women, or youth (`Any`).
- **Young Single Adults (14.1.2.3):** YSA Leaders (typically one young single adult man and one young single adult woman), Advisers (couples or individuals), and Committee Members (`Any`).
- **Activities (20.2.1):** Activities Committee Chair and Committee Members are open to men, women, or youth (`Any`).
- **Welfare and Self-Reliance (22.6.4):** Specialists and Group Facilitators are open to individuals (men or women) or married couples (`Any`).
- **Meetinghouse Facilities (35.2.9):** The Ward Building Representative may be an adult male or female member (`Any`). Schedulers and cleaning coordinators are likewise open to men or women (`Any`).
- **History & Technology (33.7.1, 33.10):** History Specialists and Technology Specialists are explicitly open to men, women, and youth (`Any`).
- **Disabilities & Interpreters (38.8.28.6–9):** Disability Specialists, Activity Leaders, and Language/Sign Interpreters are open to men, women, or youth (`Any`).

---

## 4. Complete Inventory of LCR Fixture Callings

Every calling title extracted from the actual LCR PDF fixture (`fixtures/lcr-reports/organizations-and-callings.pdf`) is categorized below with its organization, group, standard/custom status, and verified gender rule:

| LCR Organization | LCR Group Heading | LCR Calling Title | Custom? | Gender Rule | Governing Handbook Section |
|---|---|---|:---:|:---:|---|
| **Bishopric** | Bishopric | Bishop | No | `M` | 7.1, 30.8.1 |
| **Bishopric** | Bishopric | Bishopric First Counselor | No | `M` | 7.1, 30.8.1 |
| **Bishopric** | Bishopric | Bishopric Second Counselor | No | `M` | 7.1, 30.8.1 |
| **Bishopric** | Bishopric | Ward Executive Secretary | No | `M` | 7.3, 30.8.1 |
| **Bishopric** | Bishopric | Ward Assistant Executive Secretary | No | `M` | 7.3, 30.8.1 |
| **Bishopric** | Bishopric | Ward Clerk | No | `M` | 7.4, 33.4.2, 30.8.1 |
| **Bishopric** | Bishopric | Ward Assistant Clerk--Membership | No | `M` | 33.4.3, 30.8.1 |
| **Bishopric** | Bishopric | Ward Assistant Clerk--Finance | No | `M` | 33.4.3, 34.2.2, 30.8.1 |
| **Elders Quorum** | Elders Quorum Presidency | Elders Quorum President | No | `M` | 8.3.3.1, 30.8.1 |
| **Elders Quorum** | Elders Quorum Presidency | Elders Quorum First Counselor | No | `M` | 8.3.3.1, 30.8.1 |
| **Elders Quorum** | Elders Quorum Presidency | Elders Quorum Second Counselor | No | `M` | 8.3.3.1, 30.8.1 |
| **Elders Quorum** | Elders Quorum Presidency | Elders Quorum Secretary | No | `M` | 8.3.4, 30.8.1 |
| **Elders Quorum** | Teachers | Elders Quorum Teacher | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Ministering | Elders Quorum Ministering Secretary | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Activities | Elders Quorum Activity Coordinator | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Activities | Elders Quorum Assistant Activity Coordinator | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Activities | Elders Quorum Activity Committee Member | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Service | Elders Quorum Service Coordinator | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Service | Elders Quorum Assistant Service Coordinator | No | `M` | 8.3.5, 30.8.1 |
| **Elders Quorum** | Service | Elders Quorum Service Committee Member | No | `M` | 8.3.5, 30.8.1 |
| **Relief Society** | Relief Society Presidency | Relief Society President | No | `F` | 9.3.2.1, 30.8.1 |
| **Relief Society** | Relief Society Presidency | Relief Society First Counselor | No | `F` | 9.3.2.1, 30.8.1 |
| **Relief Society** | Relief Society Presidency | Relief Society Second Counselor | No | `F` | 9.3.2.1, 30.8.1 |
| **Relief Society** | Relief Society Presidency | Relief Society Secretary | No | `F` | 9.3.3, 30.8.1 |
| **Relief Society** | Teachers | Relief Society Teacher | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Ministering | Relief Society Ministering Secretary | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Activities | Relief Society Activity Coordinator | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Activities | Relief Society Assistant Activity Coordinator | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Activities | Relief Society Activity Committee Member | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Service | Relief Society Service Coordinator | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Service | Relief Society Assistant Service Coordinator | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Service | Relief Society Service Committee Member | No | `F` | 9.3.4, 30.8.1 |
| **Relief Society** | Service | Relief Society Compassionate Service Committee | **Yes** | `F` | 9.3.4, 9.2.2.2 |
| **Aaronic Priesthood Quorums** | Presidency of Aaronic Priesthood | Bishop | No | `M` | 10.3, 30.8.1 |
| **Aaronic Priesthood Quorums** | Presidency of Aaronic Priesthood | Bishopric First Counselor | No | `M` | 10.3, 30.8.1 |
| **Aaronic Priesthood Quorums** | Presidency of Aaronic Priesthood | Bishopric Second Counselor | No | `M` | 10.3, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Presidency | Priests Quorum President | No | `M` | 10.3, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Presidency | Priests Quorum First Assistant | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Presidency | Priests Quorum Second Assistant | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Presidency | Priests Quorum Secretary | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Adult Leaders | Priests Quorum Adviser | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Priests Quorum Adult Leaders | Priests Quorum Specialist | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Presidency | Teachers Quorum President | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Presidency | Teachers Quorum First Counselor | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Presidency | Teachers Quorum Second Counselor | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Presidency | Teachers Quorum Secretary | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Adult Leaders | Teachers Quorum Adviser | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Teachers Quorum Adult Leaders | Teachers Quorum Specialist | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Deacons Quorum Presidency | Deacons Quorum President | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Deacons Quorum Presidency | Deacons Quorum First Counselor | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Deacons Quorum Presidency | Deacons Quorum Second Counselor | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Deacons Quorum Presidency | Deacons Quorum Secretary | No | `M` | 10.4.1, 30.8.1 |
| **Aaronic Priesthood Quorums** | Deacons Quorum Adult Leaders | Deacons Quorum Adviser | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Additional Aaronic Priesthood | Aaronic Priesthood Quorums Specialist - Camp Director | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Additional Aaronic Priesthood | Aaronic Priesthood Quorums Specialist - Assistant Camp Director | No | `M` | 10.5, 30.8.1 |
| **Aaronic Priesthood Quorums** | Additional Aaronic Priesthood | Young Men Stake Youth Committee Member | No | `M` | 10.4.1, 29.3.9 |
| **Aaronic Priesthood Quorums** | Additional Aaronic Priesthood | Trek Leader | **Yes** | `M` | 10.5, 20.2.1 |
| **Young Women** | Young Women Presidency | Young Women President | No | `F` | 11.3.2, 30.8.1 |
| **Young Women** | Young Women Presidency | Young Women First Counselor | No | `F` | 11.3.2, 30.8.1 |
| **Young Women** | Young Women Presidency | Young Women Second Counselor | No | `F` | 11.3.2, 30.8.1 |
| **Young Women** | Young Women Presidency | Young Women Secretary | No | `F` | 11.3.3, 30.8.1 |
| **Young Women** | Young Women Presidency | Young Women Specialist | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Gatherers of Light Class Presidency | Gatherers of Light Class President | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Gatherers of Light Class Presidency | Gatherers of Light Class First Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Gatherers of Light Class Presidency | Gatherers of Light Class Second Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Gatherers of Light Class Presidency | Gatherers of Light Class Secretary | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Gatherers of Light Class Adult Leaders | Gatherers of Light Class Adviser | No | `F` | 11.3.5, 30.8.1 |
| **Young Women** | Gatherers of Light Class Adult Leaders | Gatherers of Light Specialist | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Messengers of Hope Class Presidency | Messengers of Hope Class President | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Messengers of Hope Class Presidency | Messengers of Hope Class First Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Messengers of Hope Class Presidency | Messengers of Hope Class Second Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Messengers of Hope Class Presidency | Messengers of Hope Class Secretary | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Messengers of Hope Class Adult Leaders | Messengers of Hope Class Adviser | No | `F` | 11.3.5, 30.8.1 |
| **Young Women** | Messengers of Hope Class Adult Leaders | Messengers of Hope Specialist | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Builders of Faith Class Presidency | Builders of Faith Class President | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Builders of Faith Class Presidency | Builders of Faith Class First Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Builders of Faith Class Presidency | Builders of Faith Class Second Counselor | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Builders of Faith Class Presidency | Builders of Faith Class Secretary | No | `F` | 11.3.4.1, 30.8.1 |
| **Young Women** | Builders of Faith Class Adult Leaders | Builders of Faith Class Adviser | No | `F` | 11.3.5, 30.8.1 |
| **Young Women** | Builders of Faith Class Adult Leaders | Builders of Faith Specialist | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Class Adviser | No | `F` | 11.3.5, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist - Activities | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist - Camp Director | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist - Assistant Camp Director | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Stake Youth Committee | No | `F` | 11.3.4.4, 29.3.9 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist - Sports | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Young Women Specialist - Sports Assistant | No | `F` | 11.3.6, 30.8.1 |
| **Young Women** | Additional Young Women Callings | Stake Sports Youth Representative | **Yes** | `F` | 11.3.4.4, 20.2.1 |
| **Young Women** | Additional Young Women Callings | Stake Youth Council Rep | **Yes** | `F` | 11.3.4.4, 29.3.9 |
| **Young Women** | Additional Young Women Callings | Trek Leader | **Yes** | `F` | 11.3.6, 20.2.1 |
| **Sunday School** | Sunday School Presidency | Sunday School President | No | `Any`* | 13.2.2.1, 30.8.1 |
| **Sunday School** | Sunday School Presidency | Sunday School First Counselor | No | `Contingent`* | 13.2.2.1, 30.8.1 |
| **Sunday School** | Sunday School Presidency | Sunday School Second Counselor | No | `Contingent`* | 13.2.2.1, 30.8.1 |
| **Sunday School** | Sunday School Presidency | Sunday School Secretary | No | `Contingent`* | 13.2.2.1, 30.8.1 |
| **Sunday School** | Away on Missions / Gospel Doctrine / Gospel Foundations / Courses 11–17 | Sunday School Teacher | No | `Any` | 13.2.3, 30.8.1 |
| **Sunday School** | Resource Center | Resource Center Specialist | No | `Any` | 13.2.5, 30.8.1 |
| **Primary** | Primary Presidency | Primary President | No | `F` | 12.3.2, 30.8.1 |
| **Primary** | Primary Presidency | Primary First Counselor | No | `F` | 12.3.2, 30.8.1 |
| **Primary** | Primary Presidency | Primary Second Counselor | No | `F` | 12.3.2, 30.8.1 |
| **Primary** | Primary Presidency | Primary Secretary | No | `F` | 12.3.3, 30.8.1 |
| **Primary** | Music | Primary Pianist | No | `Any` | 12.3.4, 12.5.3 |
| **Primary** | Music | Primary Music Leader | No | `Any` | 12.3.4, 12.5.3 |
| **Primary** | Sunbeam / CTR 4–6 / Valiant 7–10 / Unassigned | Primary Teacher | No | `Any` | 12.3.5, 12.5.3 |
| **Primary** | Nursery | Nursery Leader | No | `Any` | 12.3.5, 12.5.3 |
| **Primary** | Primary Activities - Boys | Valiant Activities Leader | No | `Any` | 12.3.6, 12.5.3 |
| **Primary** | Primary Activities - Girls | Valiant Activities Leader | No | `Any` | 12.3.6, 12.5.3 |
| **Ward Missionaries** | Ward Missionaries | Ward Mission Leader | No | `M` | 23.6.3, 30.8.1 |
| **Ward Missionaries** | Ward Missionaries | Assistant Ward Mission Leader | No | `M` | 23.6.3, 30.8.1 |
| **Ward Missionaries** | Ward Missionaries | Ward Missionary | No | `Any` | 23.6.4, 30.8.1 |
| **Temple and Family History** | Temple and Family History | Ward Temple and Family History Leader | No | `M` | 25.2.3, 30.8.1 |
| **Temple and Family History** | Temple and Family History | Ward Temple and Family History Consultant | No | `Any` | 25.2.4, 30.8.1 |
| **Temple and Family History** | Temple and Family History | Temple Ordinance Worker | **Yes** | `Any` | 25.2.4, 27.1 |
| **Temple and Family History** | Temple and Family History | Temple Prep Instructor | **Yes** | `Any` | 25.2.8 |
| **Temple and Family History** | Temple and Family History | Temple Shift Coordinator | **Yes** | `Any` | 25.2.4 |
| **Young Single Adult** | Young Single Adult | Young Single Adult Adviser | No | `Any` | 14.1.2.3, 30.8.1 |
| **Young Single Adult** | Young Single Adult | Young Single Adult Committee Chair | No | `Any` | 14.1.2.3, 30.8.1 |
| **Young Single Adult** | Young Single Adult | Young Single Adult Committee Member | No | `Any` | 14.1.2.4, 30.8.1 |
| **Other Callings** | Facilities | Building Representative | No | `Any` | 35.2.9, 30.8.1 |
| **Other Callings** | Facilities | Scheduler--Building 1..5 | No | `Any` | 35.2.9, 30.8.1 |
| **Other Callings** | Facilities | Assistant Building Cleaning Coordinator | **Yes** | `Any` | 35.2.9, 30.8.1 |
| **Other Callings** | Facilities | Assistant Building Representative | **Yes** | `Any` | 35.2.9, 30.8.1 |
| **Other Callings** | Facilities | Building Cleaning Coordinator | **Yes** | `Any` | 35.2.9, 30.8.1 |
| **Other Callings** | For the Strength of Youth | FSY Conferences Representative | No | `Any` | 20.3.5, 30.8.1 |
| **Other Callings** | History | History Specialist | No | `Any` | 33.7.1, 30.8.1 |
| **Other Callings** | Music | Priesthood Pianist or Organist | No | `Any` / `M` | 19.4.3 |
| **Other Callings** | Music | Priesthood Music Director | No | `M` | 19.4.3 |
| **Other Callings** | Music | Choir Accompanist | No | `Any` | 19.4.3.3 |
| **Other Callings** | Music | Music Adviser | No | `Any` | 19.4.3 |
| **Other Callings** | Music | Choir Director | No | `Any` | 19.4.3.3 |
| **Other Callings** | Music | Accompanist | No | `Any` | 19.4.3.2 |
| **Other Callings** | Music | Music Leader | No | `Any` | 19.4.3.1 |
| **Other Callings** | Music | Music Coordinator | No | `Any` | 19.4.2 |
| **Other Callings** | Technology | Email Communication Specialist | No | `Any` | 30.8.1, 38.8.10 |
| **Other Callings** | Technology | Technology Specialist | No | `Any` | 33.10, 30.8.1 |
| **Other Callings** | Technology | Ward/Branch Interpreter | No | `Any` | 38.8.28.6, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Disability Activity Leader | No | `Any` | 38.8.28.8, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Disability Specialist | No | `Any` | 38.8.28.9, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Welfare and Self-Reliance Specialist | No | `Any` | 22.6.4, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Self-Reliance Group Facilitator | No | `Any` | 22.6.4, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Education Specialist | **Yes** | `Any` | 22.6.4, 30.8.1 |
| **Other Callings** | Welfare and Self-Reliance | Humanitarian Chair | **Yes** | `Any` | 22.6.4, 30.8.1 |
| **Other Callings** | Additional Callings | Activities Committee | **Yes** | `Any` | 20.2.1, 30.8.1 |
| **Other Callings** | Additional Callings | Activities Committee Chair | **Yes** | `Any` | 20.2.1, 30.8.1 |
| **Other Callings** | Additional Callings | Emergency Preparedness Specialist | **Yes** | `Any` | 22.6.4, 30.8.1 |
| **Other Callings** | Additional Callings | Missionary Plaque Specialist | **Yes** | `Any` | 30.8.1 |
| **Other Callings** | Additional Callings | Trek Food Committee / Chair | **Yes** | `Any` | 20.2.1, 30.8.1 |
| **Other Callings** | Additional Callings | Trek Leader (Additional) | **Yes** | `Any` | 20.2.1, 30.8.1 |
| **Other Callings** | Additional Callings | Ward Athletic Director | **Yes** | `Any` | 20.2.1, 30.8.1 |

---

## 5. Critical Edge Cases & Architectural Recommendations for WardBoard (B-068)

### 1. Organization Name Alone Is Insufficient
A naive heuristic checking only the organization name will produce incorrect warnings and false negatives:
- **Primary:** If classified by organization name `Primary` -> `Female`, WardBoard would erroneously flag every male Primary teacher, male nursery leader, male Primary music leader, or married couple called to nursery/Valiant classes.
- **Sunday School:** If classified as `Male` (based on traditional priesthood models), WardBoard would erroneously flag female Sunday School teachers (who comprise roughly half of Sunday School teachers) and female Sunday School presidencies allowed under recent handbook updates.
- **Ward Missionaries & Temple and Family History:** In both organizations, the **Leader** is `M` (Melchizedek Priesthood), whereas the **Consultants** and **Missionaries** are open to all members (`Any`).

### 2. The Sunday School Presidency Dynamic Constraint
Handbook 13.2.2.1 introduces a unique dynamic relationship:
- If Sunday School President is **Male**, Counselors and Secretary must be **Male**.
- If Sunday School President is **Female**, Counselors and Secretary must be **Female**.
- *Implementation Strategy for WardBoard:*
  - In a static title classification table, Sunday School President, Counselors, and Secretary should be marked with a special constraint (e.g. `gender: 'presidency_aligned'`).
  - When the board evaluates a placement in the Sunday School Presidency:
    1. If the President slot is filled, evaluate counselor/secretary candidates against the President's gender.
    2. If the President slot is changed, re-evaluate or flag existing counselors if there is a gender mismatch.

### 3. Primary Leadership vs Teaching / Activities
In `Primary`, the rule must bifurcate on the calling title:
- Titles containing `President`, `Counselor`, or `Secretary` -> `F` (Adult women only).
- Titles containing `Teacher`, `Nursery Leader`, `Music Leader`, `Pianist`, `Accompanist`, or `Activity Leader` / `Valiant` -> `Any`.

### 4. Aaronic Priesthood vs Young Women Symmetry
- Any calling within the `Aaronic Priesthood Quorums` organization tree (Presidency of Aaronic Priesthood, Priests, Teachers, Deacons, Advisers, Specialists) is `M`.
- Any calling within the `Young Women` organization tree (Presidency, Secretary, Class Presidencies, Advisers, Specialists) is `F`.

### 5. Custom Callings (`custom: true`)
Wards frequently create custom positions (marked with `*` in LCR, such as `* Humanitarian Chair`, `* Trek Food Committee Chair`, `* Missionary Plaque Specialist`).
- If created under `Elders Quorum` or `Aaronic Priesthood Quorums`, they inherit `M`.
- If created under `Relief Society` or `Young Women`, they inherit `F`.
- If created under `Other Callings`, `Primary` (e.g., activity committees), or ward-wide organizations, they default to `Any` unless explicitly configured by the user.

### 6. Priesthood & Age Constraints (Future Scope)
While B-068 primarily targets binary member gender, several callings possess sub-constraints that may be considered in future data model expansions:
- **High Priest Required:** Bishop, Bishopric Counselors (Elders Quorum President may be Elder or High Priest).
- **Melchizedek Priesthood Required:** Ward Clerk, Assistant Ward Clerk--Finance, Executive Secretary, Ward Mission Leader, Ward Temple & Family History Leader, Sunday School President (if male).
- **Aaronic Priesthood Offices:** Priests Assistants (Priest), Teachers Quorum Presidency (Teacher), Deacons Quorum Presidency (Deacons).
- **Youth Age Classes:** Gatherers of Light (ages 11–13/14), Messengers of Hope (ages 14–15), Builders of Faith (ages 16–18).
- **Adult-Only Restrictions:** Primary teachers cannot be youth (12.3.5); Assistant Ward Clerks must hold priesthood (33.4.3).
- **Two Responsible Adults Rule (Safeguarding):** Classes or activities with children/youth (Primary, YW, Youth Sunday School, Aaronic Priesthood) require at least two responsible adults present at all times (Handbook 10.5, 11.3.5, 12.3.5, 13.3).
