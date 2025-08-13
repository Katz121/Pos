// app/lib/safeId.ts
export function safeId(prefix = 'id') {
  try {
    // มี randomUUID → ใช้เลย
    const anyCrypto: any = globalThis.crypto;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();

    // ไม่มี randomUUID แต่มี getRandomValues → สร้าง UUID v4 เอง
    if (anyCrypto?.getRandomValues) {
      const buf = new Uint8Array(16);
      anyCrypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
      buf[8] = (buf[8] & 0x3f) | 0x80; // variant
      const hex = [...buf].map(b => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
    }
  } catch {}

  // สุดท้ายจริงๆ ใช้ random()+timestamp (พอสำหรับ key ชั่วคราวฝั่ง UI)
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
