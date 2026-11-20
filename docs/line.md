# เชื่อมต่อ LINE Messaging API ฝั่งเซิร์ฟเวอร์

โค้ดชุดนี้เป็น **Node.js adapter สำหรับผู้ติดตั้งระบบนำไปเชื่อมต่อเอง** ไม่ใช่การเชื่อมต่อ LINE ที่เปิดใช้งานแล้วในเว็บ ไม่มี HTTP route หรือ webhook endpoint ถูกเปิดเพิ่ม และไม่มีการส่งข้อความจากการติดตั้ง การเปิดเว็บ หรือการรันทดสอบ

ปุ่ม LINE ในเว็บปัจจุบันทำเพียง **คัดลอกข้อความสรุปลง clipboard** ผู้ใช้ต้องนำไปวางและส่งเอง การเพิ่ม token ฝั่งเซิร์ฟเวอร์จะไม่ทำให้ปุ่มนี้ส่งข้อความอัตโนมัติ ผู้พัฒนาต้องเชื่อม workflow ที่ยืนยันตัวตนและตรวจสิทธิ์แล้วเข้ากับ adapter

## ไฟล์ที่เกี่ยวข้อง

- `integrations/line.mjs` — อ่านข้อมูล bot, ส่งข้อความ text แบบ push, ตรวจรูปแบบผู้รับ, timeout/retry และตรวจลายเซ็น webhook
- `scripts/line.mjs` — CLI สำหรับตรวจบัญชี bot หรือส่งข้อความด้วยคำสั่งที่ผู้ดูแลเรียกเอง
- `integrations/line.test.mjs` — ทดสอบด้วย mock fetch และ mock client ไม่มีการเรียก LINE จริง

ใช้ Node.js 22 ขึ้นไป โมดูลใช้ `node:crypto` และต้องอยู่ใน trusted backend/worker เท่านั้น ห้าม import เข้า `src/` หรือ bundle ฝั่ง Vite

## สิ่งที่ผู้ติดตั้งต้องเตรียม

1. สร้าง LINE Official Account และเปิดใช้งาน Messaging API ตามขั้นตอนของ LINE
2. ออก channel access token ของช่องที่จะส่งข้อความ และเก็บใน environment ของเซิร์ฟเวอร์ชื่อ `LINE_CHANNEL_ACCESS_TOKEN`
3. ถ้ารับ webhook ให้เก็บ channel secret แยกใน `LINE_CHANNEL_SECRET` token กับ secret เป็นคนละค่าและใช้แทนกันไม่ได้
4. เก็บ recipient ID ที่ได้รับจาก webhook ที่ตรวจลายเซ็นแล้ว หรือแหล่งข้อมูลที่ LINE รองรับ โดย user ID ขึ้นต้น `U`, group ID ขึ้นต้น `C`, room ID ขึ้นต้น `R` ตามด้วยอักขระ hex 32 ตัว ไม่ใช่ LINE ID ที่ผู้ใช้ตั้งเอง ไม่ใช่เบอร์โทร และไม่ใช่ชื่อกลุ่ม
5. ตรวจเงื่อนไขการส่งของบัญชี เช่น ผู้ใช้เพิ่ม Official Account เป็นเพื่อน หรือ bot อยู่ในกลุ่ม/ห้อง และตรวจโควตาแพ็กเกจ การมี ID ที่รูปแบบถูกต้องไม่ได้ยืนยันว่าผู้รับมีตัวตนหรือรับข้อความได้

ห้ามเก็บ token/secret ใน Git, หน้า UI, JSON backup, log หรือ environment ที่ขึ้นต้น `VITE_` เพราะค่าฝั่ง frontend อาจถูกส่งไปยังเบราว์เซอร์ CLI นี้อ่าน `process.env` โดยตรงและ **ไม่ได้โหลดไฟล์ `.env` ให้อัตโนมัติ**

## ตรวจข้อมูลบัญชี โดยไม่ส่งข้อความ

ตัวอย่าง PowerShell 7 ตั้งค่าเฉพาะ session ปัจจุบัน:

```powershell
$env:LINE_CHANNEL_ACCESS_TOKEN = Read-Host 'Channel access token' -MaskInput
node scripts/line.mjs check
```

คำสั่งนี้เรียก `GET https://api.line.me/v2/bot/info` เพื่อดูว่าบัญชีใดตอบกลับภายใต้ token นี้ ไม่เรียก push และไม่แสดง token ในผลลัพธ์ หากสำเร็จให้ตรวจ `displayName`, `basicId` และ `userId` ว่าเป็นบัญชีที่ต้องการก่อนเริ่มส่งจริง

## ส่งข้อความทดสอบด้วยคำสั่งโดยตั้งใจ

คำสั่งต่อไปนี้ **ส่งข้อความจริงและอาจใช้โควตาข้อความของบัญชี** ให้กรอก ID ของผู้รับที่ตกลงรับข้อความทดสอบแล้ว:

```powershell
$recipient = Read-Host 'Recipient ID'
$retryKey = [guid]::NewGuid().ToString()
node scripts/line.mjs push --to $recipient --text 'ทดสอบแจ้งเตือนจาก Smart Document Workflow' --retry-key $retryKey
```

เก็บ `$retryKey`, ผู้รับ และข้อความเดิมไว้จนทราบผล ถ้าต้อง retry ให้ใช้ **UUID เดิม ผู้รับเดิม และข้อความเดิม** ภายใน 24 ชั่วโมง ห้ามสร้าง UUID ใหม่เพื่อหลบข้อผิดพลาดหรือใช้ UUID เดิมกับข้อความอื่น หากเปิด shell ใหม่ให้โหลด retry key ที่บันทึกไว้แทนการสร้างใหม่

ผล `accepted: true` หมายถึง LINE รับคำขอแล้ว ไม่ได้ยืนยันว่าข้อความถึงผู้ใช้หรือถูกอ่าน ค่า `duplicate: true` หมายถึง LINE ตอบ 409 พร้อม `x-line-accepted-request-id` ว่าเคยรับ retry key นี้แล้ว จึงถือว่าคำขอเดิมได้รับการยอมรับ ไม่ใช่การส่งข้อความเพิ่ม

เมื่อตรวจเสร็จลบค่าจาก session ที่ไม่ใช้งานแล้ว:

```powershell
Remove-Item Env:LINE_CHANNEL_ACCESS_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:LINE_CHANNEL_SECRET -ErrorAction SilentlyContinue
```

## เรียกจาก backend หรือ worker

```js
import { randomUUID } from 'node:crypto';
import { createLineClient } from '../integrations/line.mjs';

const line = createLineClient(); // อ่าน LINE_CHANNEL_ACCESS_TOKEN จาก process.env

// เรียกหลังตรวจสิทธิ์และบันทึก notification job ในฐานข้อมูลแล้วเท่านั้น
// job.retryKey ต้องสร้างและบันทึกเพียงครั้งเดียว เช่น randomUUID()
async function sendQuoteNotification(job) {
  return line.pushText({
    to: job.recipientId,
    text: job.text,
    retryKey: job.retryKey,
  });
}
```

ตัวอย่างนี้ไม่ได้เปิด route ให้ใครส่งข้อความได้ ผู้ติดตั้งต้องผูกกับ backend ที่ยืนยันตัวตน ตรวจสิทธิ์บริษัท/ผู้ใช้ ตรวจความยินยอมของผู้รับ และโหลด recipient กับข้อมูลเอกสารจากข้อมูลที่เชื่อถือได้ ไม่รับ token หรือ recipient ตามอำเภอใจจาก request ของ frontend

ควรเก็บ outbox/job ในฐานข้อมูลก่อนเรียก API โดยมี ID งาน, tenant, document/revision, event, recipient, payload เดิม, retry key, สถานะ, จำนวนครั้ง, request ID และเวลาส่งครั้งแรก ป้องกันงานซ้ำด้วย unique key ตามเหตุการณ์ทางธุรกิจ ตั้งเวลาติดตามด้วย scheduler/worker ที่ฝั่งเซิร์ฟเวอร์ และตรวจโควตาก่อนส่งจำนวนมาก

### พฤติกรรมและข้อจำกัดของ adapter

- ส่ง text ครั้งละหนึ่งข้อความ ยาวไม่เกิน 5,000 UTF-16 code units (`text.length` ใน JavaScript) ไม่รองรับข้อความว่าง อีโมจิบางตัวนับมากกว่าหนึ่งหน่วย
- ใช้ `POST https://api.line.me/v2/bot/message/push` เท่านั้น พร้อม bearer token, JSON และ `X-Line-Retry-Key` ตั้งแต่คำขอแรก ไม่ตาม HTTP redirect เพื่อไม่ส่ง credential ไปปลายทางอื่น
- ถ้าไม่ระบุ `retryKey` จะสร้าง UUID ให้ภายในหนึ่งการเรียกและคืนกลับในผลสำเร็จ/ข้อผิดพลาด แต่ในงานจริงควรสร้างและเก็บ key ก่อนเรียก เพื่อกู้คืนได้แม้ process หยุดกลางทาง
- timeout เริ่มต้น 10 วินาทีต่อครั้ง ครอบคลุมการอ่าน body และใช้ AbortController เพื่อยกเลิกคำขอ
- retry อัตโนมัติสูงสุด 2 ครั้งเพิ่มเติมจากครั้งแรก เฉพาะ network error, timeout และ HTTP 5xx โดยรอ 500 แล้ว 1,000 มิลลิวินาที ใช้ body และ retry key เดิมทุกครั้ง ปรับ `maxRetries` ได้ 0–3
- ไม่ retry HTTP 4xx อัตโนมัติ รวม 401/403/429 ให้แก้ credential/สิทธิ์/โควตาก่อน ส่วน 409 ที่ไม่มี accepted-request-id ยังคงเป็นข้อผิดพลาด
- ข้อผิดพลาดมี `code`, `status`, `requestId`, `retryKey`, `retryable` เท่าที่มี โดยไม่แนบ token, raw response body, raw fetch error หรือ stack ใน CLI
- ไม่มีฐานข้อมูล คิวงาน scheduler การเก็บ retry key ถาวร การนับโควตา หรือการยืนยัน delivery ในโมดูลนี้ ผู้ติดตั้งต้องจัดการส่วนเหล่านั้นเอง

## ตรวจ webhook signature ก่อนแปลง JSON

```js
import { verifyWebhookSignature } from '../integrations/line.mjs';

// rawBody เป็น Buffer/Uint8Array หรือข้อความ UTF-8 เดิมที่ HTTP server รับมา
// signature คือค่า x-line-signature เดิมจาก request header
const valid = verifyWebhookSignature({ rawBody, signature });
if (!valid) {
  // จบคำขอด้วยสถานะ 401/403 โดยไม่ parse หรือประมวลผล event
  throw new Error('Invalid webhook signature');
}
const eventBody = JSON.parse(Buffer.from(rawBody).toString('utf8'));
```

helper ใช้ HMAC-SHA256 + Base64 และ `timingSafeEqual` ห้าม stringify JSON ใหม่ ตัดช่องว่าง แก้ newline หรือให้ middleware เปลี่ยน body ก่อนตรวจ หากไม่มี `LINE_CHANNEL_SECRET` จะ throw และไม่ผ่านการตรวจ ต้องกำหนด body size limit ที่ HTTP server ด้วย

signature ที่ถูกต้องไม่ได้ป้องกันการส่ง event เดิมซ้ำ ผู้ติดตั้งต้องเก็บ/deduplicate `webhookEventId`, คำนึงถึง webhook redelivery และรับรองว่าการประมวลผลซ้ำไม่ทำให้สร้างเอกสารหรือแจ้งเตือนซ้ำ ตัวอย่างนี้ไม่สร้าง webhook endpoint และไม่เปิด endpoint ส่งข้อความแบบไม่ยืนยันตัวตน

## ทดสอบโดยไม่ส่งข้อความ

```powershell
node --test integrations/line.test.mjs
```

ชุดทดสอบใช้ mock เท่านั้น ครอบคลุม validation, payload, retry key, timeout, network/HTTP error, redaction, webhook signature และคำสั่ง CLI การรันทดสอบไม่ต้องมีบัญชี LINE หรือ token จริง

## เอกสารทางการ

ตรวจเนื้อหาจากเอกสาร LINE วันที่ 20 พฤศจิกายน 2026:

- [Messaging API: Send push message](https://developers.line.biz/en/reference/messaging-api/#send-push-message)
- [Messaging API: Get bot info](https://developers.line.biz/en/reference/messaging-api/#get-bot-info)
- [Retry failed API requests: retry key และอายุ 24 ชั่วโมง](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [Get user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)
- [Character counting in a text](https://developers.line.biz/en/docs/messaging-api/text-character-count/)
