# Database reference and mapping

เว็บแอปปัจจุบันเก็บข้อมูลใน localStorage **ไม่ได้เชื่อมฐานข้อมูล** `supabase/schema.sql` เป็น schema อ้างอิงสำหรับพัฒนา backend บน Supabase/PostgreSQL ผู้ติดตั้งเลือกใช้ฐานข้อมูลอื่นได้ โดยต้องกำหนดสิทธิ์และ transaction เอง

การเติม `VITE_SUPABASE_URL` หรือ `VITE_SUPABASE_ANON_KEY` ใน `.env` ยังไม่ทำให้เว็บอ่าน/เขียน Supabase ไม่มี Supabase client หรือ data adapter เชื่อม UI อยู่ในรุ่นนี้

## สิ่งที่ schema มี

| ตาราง | วัตถุประสงค์ |
| --- | --- |
| `organizations` | ข้อมูลกิจการและคำนำหน้าเอกสาร |
| `organization_members` | สมาชิกและ role ของกิจการ |
| `customers` | ลูกค้าที่แยกด้วย `organization_id` |
| `products` | สินค้า/บริการ ราคาหน่วยสตางค์ และข้อมูล VAT |
| `quotes` | หัวใบเสนอราคา snapshot ลูกค้า/ผู้ขาย สถานะ วันติดตาม และยอดรวม |
| `quote_items` | รายการ snapshot ของใบเสนอราคา |
| `quote_sequences` | ตัวนับเลขต่อกิจการและปี |
| `audit_events` | event ของหัวใบเสนอราคาจาก trigger |
| `integration_outbox` | จุดพัก event สำหรับ worker ที่จะพัฒนาภายหลัง |

RLS ใช้ helper ตรวจสมาชิก/admin ตามองค์กร ตาราง sequence ไม่มีสิทธิ์เขียนโดย client ตามปกติ การสร้างองค์กรและ owner คนแรกต้องผ่าน server/admin ที่เชื่อถือได้ ยังไม่มี onboarding หรือ invitation flow

trigger สร้างเลขจากคำนำหน้ากิจการ ปีของ `issue_date` และตัวนับใน transaction การ rollback insert จะ rollback ตัวนับด้วย เลขเรียงมีอย่างน้อย 5 หลักและไม่ตัดค่าที่เกิน 5 หลัก conflict target อ้างชื่อ primary-key constraint โดยตรงเพื่อเลี่ยงชื่อชนกับ output variable ใน PL/pgSQL

schema จำกัดการเปลี่ยนเลขเอกสาร องค์กร และวันที่ออกหลัง insert และไม่อนุญาตย้ายลูกค้า สินค้า รายการ หรือ membership ไปองค์กรอื่น `created_by` ยังล้างเป็น `NULL` ได้เมื่อมีการลบบัญชีผู้ใช้ตาม foreign key; backend ที่จะพัฒนาต้องควบคุมการแก้ข้อมูลอ้างอิงผู้สร้างเอง

ใบเสนอราคาใหม่ต้องเริ่มเป็น `draft` ขณะที่เป็น draft แก้เนื้อหาและรายการได้ จากนั้นบันทึกสถานะออกเอกสารเป็นขั้นตอนสุดท้าย เอกสารที่พ้น draft แล้วเปลี่ยนสถานะและ `follow_up_date` ได้ แต่กลับ draft หรือแก้เนื้อหาหัว/รายการไม่ได้ trigger รายการล็อก parent row เพื่อให้การแก้รายการกับการเปลี่ยนสถานะออกเอกสารรอกัน การลบ parent ผ่าน trusted admin ยัง cascade ลบรายการได้; client ปกติไม่มีสิทธิ์ลบหัวใบเสนอราคา

## Mapping ที่ต้องทำก่อนเชื่อม UI

localStorage ใช้ camelCase และ ID แบบ string ส่วน schema ใช้ snake_case และ UUID ต้องสร้าง data adapter และ migration ห้ามนำ JSON สำรองไป insert ตรง ๆ

| ข้อมูลเว็บ | โครงสร้าง SQL | ช่องว่าง / งานที่ต้องทำ |
| --- | --- | --- |
| `settings.company*` | คอลัมน์ใน `organizations` | เลือกองค์กรจาก session และตรวจค่าฝั่งเซิร์ฟเวอร์ |
| `settings.defaultVat`, `defaultValidity` | ยังไม่มีค่าเริ่มต้นเหล่านี้ | เพิ่ม schema/settings contract |
| `customers[].contact` | `contact_name` | แปลง field; เว็บยังไม่มี tax ID / branch ของลูกค้า |
| `products[].price`, `vat` | `unit_price_satang`, `vat_applicable` | เก็บเงินเป็นสตางค์ และกำหนดอัตรา VAT ที่ใช้ |
| `quotes[].id`, `customerId` | UUID และ tenant-scoped foreign key | map ID ระหว่าง migration และห้ามข้ามองค์กร |
| `quotes[].number`, `sequences` | trigger + `quote_sequences` | เลิกใช้เลขใน browser เป็น authoritative; รับเลขคืนจาก DB |
| `issueDate`, `validUntil` | `issue_date`, `valid_until` | เว็บใช้วัน Asia/Bangkok; backend ต้องกำหนดให้สอดคล้อง |
| `followUpDate` | `follow_up_date` | map ค่าว่างในเว็บเป็น `NULL`; ต้องเพิ่ม worker เพื่อแจ้งเตือนจริง |
| `customerSnapshot` | `customer_*_snapshot` | แปลง object เป็นคอลัมน์และกำหนดจุดที่ snapshot คงที่ |
| `companySnapshot` | `company_snapshot` แบบ JSONB object | ส่ง object ข้อมูลผู้ขาย ณ วันที่เตรียมเอกสาร; API ต้องตรวจ required fields ก่อนออกเอกสาร |
| `items[]` | `quote_items` | map field และ position; รายการเว็บไม่มี product FK |
| `vatRate` | `vat_rate_basis_points` | เว็บใช้เปอร์เซ็นต์เต็ม ต้องคูณ 100 และกำหนดข้อจำกัดร่วมกัน |
| `status` | `status` | SQL มี `cancelled` เพิ่มจากเว็บ; ต้องกำหนด state machine |
| `createdAt` | `created_at`, `created_by` | ให้ server กำหนดเวลาและผู้สร้าง authoritative |

เลขในเว็บเป็นลำดับตาม prefix/ปีในเครื่อง ส่วน schema เป็นลำดับต่อองค์กร/ปีและนำ prefix มาประกอบข้อความ ต้องออกแบบการนำเอกสารเก่าเข้าและเริ่มตัวนับโดยไม่ทำเลขซ้ำ

## เงินและ transaction

เงินทั้งสองส่วนเป็นจำนวนเต็มหน่วยสตางค์ แต่ schema ยังไม่คำนวณจาก quantity และ price ให้ `check` ตรวจความสัมพันธ์บางส่วน เช่นยอดรวม = subtotal − discount + VAT และจำนวนไม่ติดลบ ไม่ได้ยืนยันว่ายอดหัวตรงผลรวม `quote_items`

frontend ใช้ยอดรายการหลังส่วนลดรายบรรทัดเป็น `itemSubtotal` แล้วหักส่วนลดท้ายบิลและคำนวณ VAT รวมครั้งเดียว ส่วน schema มี subtotal/discount/VAT ทั้งหัวและบรรทัด ต้องกำหนดนิยาม gross/net ให้ตรงกัน และวิธีกระจายส่วนลด/VAT ลงบรรทัดให้ผลรวมตรงทุกสตางค์

ต้องมี API/RPC ตรวจรายการและสิทธิ์ คำนวณใหม่ บันทึก draft และรายการ แล้วเปลี่ยนสถานะออกเอกสารและสร้าง event หลังข้อมูลครบใน transaction เดียว ปัจจุบันไม่มี RPC นี้ การ insert หัวและรายการแยกคำขออาจได้ข้อมูลไม่ครบเมื่อคำขอหนึ่งล้มเหลว การสร้างหัวที่สถานะออกเอกสารโดยตรงและการเพิ่มรายการหลังออกเอกสารถูก guard ปฏิเสธ

## ข้อจำกัดของ schema อ้างอิง

- ยังไม่ผ่าน migration หรือทดสอบ RLS/concurrency กับ Supabase project ใน repository นี้ เป็นสคริปต์สร้างครั้งแรก ไม่ใช่ migration ที่รันซ้ำได้
- role `member` ยังแก้ข้อมูลธุรกิจและสถานะผ่าน policy ในองค์กรได้ ต้องกำหนดสิทธิ์จริงก่อนเปิด API
- มี guard ล็อกเนื้อหาหัว/รายการหลังออกเอกสารและห้ามกลับ draft แต่ยังไม่มี revision model, version token หรือ state machine ครบ เช่น ลำดับอนุมัติ/ยกเลิกระหว่างสถานะที่ไม่ใช่ draft ต้องเพิ่มตามกระบวนการจริง
- ยังไม่มีการป้องกันลบ owner คนสุดท้าย invitation หรือการโอน ownership
- audit trigger บันทึกการสร้าง/แก้หัว `quotes` เท่านั้น ไม่เก็บ diff ครบทุก field ไม่ครอบคลุม items/ข้อมูลแม่ และไม่ใช่ immutable audit trail ครบระบบ
- outbox เป็น event หัวเอกสาร ไม่ได้รอรายการครบโดย API ไม่มี worker, claim/lease, retry policy, idempotency key หรือผลส่งที่เชื่อม LINE adapter
- ยังไม่มีตาราง PDF, private storage policies, signed URL, ใบรับงาน เอกสารบัญชี หรือรายงานตามเวลา
- ยังไม่มี migration จาก JSON ของเว็บ หรือเครื่องมือ backup/restore ฐานข้อมูล ต้องเพิ่มและทดสอบตาม deployment

## ลำดับเชื่อมต่อ

1. เลือก backend/database และ review schema กับนโยบายสิทธิ์
2. เพิ่ม migration สำหรับ mapping ที่ขาด และ provisioning องค์กร/owner ผ่าน trusted server
3. เพิ่ม authentication และเลือก active organization จาก session
4. สร้าง transactional API/RPC พร้อม server totals, sequence และ revision/locking
5. ทดสอบ tenant isolation, การออกเลขพร้อมกัน, rollback, role และเอกสารที่ออกแล้ว
6. เขียน frontend data adapter และย้ายข้อมูลเดิม ไม่ใช้ localStorage และ DB เป็น authoritative สองทางพร้อมกัน
7. เพิ่ม outbox worker และเชื่อมบริการหลังข้อมูลเอกสารครบ พร้อม retry และผลการส่ง

เก็บ service-role key และ token ภายนอกบนเซิร์ฟเวอร์เท่านั้น `VITE_*` เข้า frontend bundle ได้ ใช้เฉพาะค่าที่เปิดเผยต่อ browser ได้และต้องอาศัย authorization/RLS ที่ถูกต้อง
