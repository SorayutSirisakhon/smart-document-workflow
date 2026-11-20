# Architecture

เอกสารนี้อธิบายโค้ดปัจจุบันและจุดต่อสำหรับพัฒนาเป็นระบบหลายผู้ใช้ ชื่อ repository คือ `smart-document-workflow`

## ระบบที่รันอยู่ตอนนี้

```text
Browser
  React UI (src/App.jsx)
    ├─ domain logic (src/domain.mjs)
    ├─ localStorage ใน browser/origin เดียว
    ├─ JSON export/import ผ่านไฟล์ที่ผู้ใช้เลือก
    ├─ window.print → เครื่องพิมพ์ / Save as PDF
    ├─ mailto: → โปรแกรมอีเมลของผู้ใช้
    └─ clipboard → ผู้ใช้นำข้อความไปส่งเอง

Server-side / CLI แยกต่างหาก
  scripts/line.mjs → integrations/line.mjs → LINE Messaging API

Reference only
  supabase/schema.sql → ต้องตรวจและติดตั้งในฐานข้อมูลของผู้ติดตั้ง
```

เว็บแอปไม่มี backend process หรือ network data adapter ไม่เชื่อมไปยัง Supabase, LINE, Google Sheets หรือผู้ให้บริการอีเมล การรัน Vite ให้บริการไฟล์เว็บและพัฒนา frontend ไม่ได้สร้างฐานข้อมูลหรือ worker

## ส่วนประกอบ

| ตำแหน่ง | หน้าที่ | ขอบเขต |
| --- | --- | --- |
| `src/App.jsx` | UI, state, localStorage, import/export และหน้าพิมพ์ | ทำงานในเบราว์เซอร์ |
| `src/domain.mjs` | คำนวณเงิน วันที่ และตรวจข้อมูลที่อ่าน/นำเข้า | ไม่เข้าฐานข้อมูล |
| `src/domain.test.mjs` | ชุดทดสอบ domain logic | ไม่ทดสอบระบบภายนอก |
| `src/styles.css` | responsive UI และ print layout | ผลพิมพ์ขึ้นกับเบราว์เซอร์/เครื่องพิมพ์ |
| `integrations/line.mjs` | adapter สำหรับ LINE Messaging API | ฝั่งเซิร์ฟเวอร์ ต้องมี configuration |
| `scripts/line.mjs` | เรียก adapter ผ่าน CLI | ไม่ถูกเรียกจาก UI และไม่มี scheduler |
| `supabase/schema.sql` | โครงสร้าง PostgreSQL/RLS/sequence/outbox อ้างอิง | ยังไม่ได้ติดตั้งหรือเชื่อม frontend |

## ข้อมูลในเครื่อง

การเปิดครั้งแรกเริ่มด้วยลูกค้า สินค้า และใบเสนอราคาว่าง ชื่อกิจการ ที่อยู่ อีเมล โทรศัพท์ และเลขผู้เสียภาษีว่าง ผู้ติดตั้งกรอกค่าจริงเอง ค่าเริ่มต้นเชิงรูปแบบ เช่น คำนำหน้า อายุใบเสนอราคา และอัตราที่ใช้คำนวณ ปรับในหน้าตั้งค่าได้

React state คือข้อมูลที่ UI ใช้ใน session และบันทึกเป็น JSON ลง localStorage `normalizeStore` ตรวจโครงสร้างข้อมูลก่อนใช้ การส่งออก JSON เป็นไฟล์สำรองที่ผู้ใช้ควบคุมเอง การนำเข้าแทนที่ข้อมูลชุดเดิม จึงควรส่งออกชุดปัจจุบันก่อนนำเข้า

ไม่มี lock, revision token หรือ conflict resolution ระหว่างแท็บ/อุปกรณ์ localStorage จึงยังใช้แทนระบบกลางหลายผู้ใช้ไม่ได้

## Workflow ใบเสนอราคา

1. ตั้งค่ากิจการและเพิ่มลูกค้า
2. สร้างร่าง เลือกลูกค้า เพิ่มรายการ ราคา จำนวน และส่วนลด
3. คำนวณยอดด้วยจำนวนเต็มหน่วยสตางค์ และเก็บ snapshot กิจการ/ลูกค้า/รายการกับเอกสาร
4. บันทึกเป็นร่างหรือรอตอบกลับ และเปลี่ยนสถานะเองเมื่อมีข้อมูลใหม่
5. พิมพ์หรือบันทึก PDF ผ่านเบราว์เซอร์ เปิดร่างอีเมล หรือคัดลอกข้อความไปส่ง LINE เอง

การจำกัดการแก้ไขเอกสารใน UI ช่วยจัดขั้นตอนทำงาน แต่ไม่ใช่ข้อจำกัดฝั่งเซิร์ฟเวอร์ ผู้ที่เข้าถึงเครื่องหรือไฟล์สำรองยังเปลี่ยนข้อมูลได้ สถานะไม่ใช่ลายมือชื่ออิเล็กทรอนิกส์ หลักฐานส่ง หรือหลักฐานอนุมัติจากลูกค้า

## LINE adapter

adapter แยกจาก bundle ฝั่งเบราว์เซอร์ ใช้ secret บนเครื่อง/เซิร์ฟเวอร์เท่านั้น CLI `npm run line:check` และ `npm run line:send` เป็นจุดตรวจการตั้งค่าด้วยบัญชีของผู้ติดตั้ง ไม่มีการเรียกจากปุ่มใบเสนอราคา และไม่มีข้อความอัตโนมัติจากการเปลี่ยนสถานะหรือวันติดตาม

หากจะเชื่อม workflow จริง ต้องมี backend ตรวจผู้ใช้และ tenant ตรวจสิทธิ์การส่ง เก็บ target อย่างเหมาะสม บันทึกผล และควบคุม retry/idempotency ห้ามส่ง token ไปยังเบราว์เซอร์หรือใช้ `VITE_*` สำหรับ secret

## เส้นทางพัฒนา

โครงสร้างเป้าหมายที่ผู้ติดตั้งต้องพัฒนาและตั้งค่า:

```text
Authenticated browser
  → Backend API / RPC (validation + tenant authorization)
    → PostgreSQL (quotes + items + sequence + audit + outbox)
    → Private document storage (generated PDF)

Outbox worker / scheduler
  → LINE / email / Sheets adapters
  → ผลการส่ง + retry + error monitoring
```

API ควรคำนวณและตรวจยอดฝั่งเซิร์ฟเวอร์ บันทึกหัวเอกสารและรายการใน transaction เดียว และออกเลขจากแหล่งกลาง อย่าใช้เลขจากเบราว์เซอร์เป็นเลข authoritative การอัปเดตควรมี version กันเขียนทับ และกำหนดการแก้เอกสารที่ออกแล้วผ่าน revision

schema ที่มีเป็นจุดอ้างอิง ไม่ใช่ API contract ที่ตรงกับ localStorage ดู [mapping และช่องว่างฐานข้อมูล](database.md) ก่อนทำ data adapter

## การตรวจสอบ

`npm test` ตรวจ domain tests และ `npm run build` ตรวจการคอมไพล์ frontend การเชื่อมฐานข้อมูลต้องเพิ่ม integration tests เรื่อง tenant isolation, concurrent numbering, rollback, snapshot/revision, server totals และ outbox ส่วน LINE ต้องทดสอบด้วย credentials และ recipient ที่ได้รับอนุญาตจริง

ภาพใน README ต้องจับจากแอปเริ่มต้นที่ไม่มีข้อมูลสมมติ ห้าม commit token, target ID หรือข้อมูลลูกค้าลงในภาพ
