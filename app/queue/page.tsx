// app/queue/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';

type Method = 'cash' | 'transfer' | 'promptpay' | 'card' | 'other';

type ItemRow = {
  qty: number;
  unit_price?: number | null;
  subtotal?: number | null;
  products: { name: string } | null;
};

type Ticket = {
  id: string;
  code: string;
  queue_status: 'queued' | 'preparing' | 'done' | 'void';
  opened_at: string;
  started_at: string | null;
  done_at: string | null;
  payment_status: 'unpaid' | 'paid';
  paid_at: string | null;
  paid_method: Method | null;
  total: number | null;
  discount_amount: number | null;
  order_items: ItemRow[];
};

export default function QueuePage() {
  const supabase = useMemo(() => createClient(), []);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [methodById, setMethodById] = useState<Record<string, Method>>({});
  const [discPctById, setDiscPctById] = useState<Record<string, number>>({});

  const HORIZON_HOURS = 12;
  const DONE_VISIBLE_MIN = 60;

  const fmtTHB = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toLine = (t: Ticket) =>
    t.order_items.map((it) => `${it.products?.name ?? '-'} × ${it.qty}`).join(' • ');

  const subtotalOf = (t: Ticket) =>
    t.order_items.reduce(
      (s, it) => s + Number(it.subtotal ?? ((it.unit_price || 0) * it.qty)),
      0
    );

  const savedDiscount = (t: Ticket) => Number(t.discount_amount || 0);

  const netOf = (t: Ticket) => {
    const sub = subtotalOf(t);
    const dis = savedDiscount(t);
    const net = sub - dis;
    return net > 0 ? net : 0;
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const since = new Date(Date.now() - HORIZON_HOURS * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, code, queue_status, opened_at, started_at, done_at,
          payment_status, paid_at, paid_method, total, discount_amount,
          order_items ( qty, unit_price, subtotal, products(name) )
        `)
        .gte('opened_at', since)
        .in('queue_status', ['queued', 'preparing', 'done'] as any)
        .order('opened_at', { ascending: true });

      if (error) throw error;
      setTickets((data || []) as any);
    } catch (e: any) {
      setErr(e?.message || 'โหลดคิวไม่สำเร็จ');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const queued = useMemo(() => tickets.filter((t) => t.queue_status === 'queued'), [tickets]);
  const preparing = useMemo(() => tickets.filter((t) => t.queue_status === 'preparing'), [tickets]);
  const doneUnpaid = useMemo(() => {
    const limit = Date.now() - DONE_VISIBLE_MIN * 60 * 1000;
    return tickets.filter(
      (t) =>
        t.queue_status === 'done' &&
        t.payment_status === 'unpaid' &&
        (!t.done_at || new Date(t.done_at).getTime() >= limit)
    );
  }, [tickets]);
  const donePaid = useMemo(() => {
    const limit = Date.now() - DONE_VISIBLE_MIN * 60 * 1000;
    return tickets.filter(
      (t) =>
        t.queue_status === 'done' &&
        t.payment_status === 'paid' &&
        (!t.done_at || new Date(t.done_at).getTime() >= limit)
    );
  }, [tickets]);

  const setQueue = async (id: string, next: Ticket['queue_status']) => {
    const patch: any = { queue_status: next };
    if (next === 'preparing') patch.started_at = new Date().toISOString();
    if (next === 'done') patch.done_at = new Date().toISOString();
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  };

  // บันทึกส่วนลด %
  const saveDiscountPercent = async (t: Ticket, pctInput?: number) => {
    try {
      const sub = subtotalOf(t);
      const pct = Math.max(0, Math.min(100, Number(pctInput ?? discPctById[t.id] ?? 0)));
      const amount = Number(((sub * pct) / 100).toFixed(2));
      const net = Number((sub - amount).toFixed(2));

      const { error } = await supabase
        .from('orders')
        .update({ discount_amount: amount, total: net })
        .eq('id', t.id);
      if (error) throw error;

      await load();
    } catch (e: any) {
      alert('บันทึกส่วนลดไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
      console.error(e);
    }
  };

  // รับเงิน
  const markPaid = async (id: string) => {
    const method = methodById[id] || 'cash';
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'paid',
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        paid_method: method,
      })
      .eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  };

  // แก้เป็นยังไม่จ่าย
  const markUnpaid = async (id: string) => {
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'open',
        payment_status: 'unpaid',
        paid_at: null,
        paid_method: null,
      })
      .eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  };

  // 🔴 ลบบิล (ลบรายการลูกก่อนกัน FK แล้วค่อยลบ orders)
  const deleteOrder = async (id: string, label: string) => {
    const ok = confirm(
      `ยืนยันลบบิล ${label} ?\nคำเตือน: การลบจะทำให้ยอดไม่ถูกรวมในรายงาน และไม่สามารถกู้คืนได้`
    );
    if (!ok) return;

    try {
      // ลบลูกก่อน (มีตารางไหนก็ลบเท่านั้น)
      const delItems = await supabase.from('order_items').delete().eq('order_id', id);
      if (delItems.error && delItems.error.code !== 'PGRST116') throw delItems.error;

      const delPays = await supabase.from('payments').delete().eq('order_id', id);
      if (delPays.error && delPays.error.code !== 'PGRST116') throw delPays.error;

      // ลบหัวบิล
      const delOrder = await supabase.from('orders').delete().eq('id', id);
      if (delOrder.error) throw delOrder.error;

      await load();
      alert('ลบบิลเรียบร้อย');
    } catch (e: any) {
      // ถ้าเจอ permission denied → ต้องตั้ง RLS policy ดูโน้ตด้านล่าง
      alert('ลบไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
      console.error(e);
    }
  };

  const methodLabel = (m?: Method | null) =>
    m === 'cash'
      ? 'เงินสด'
      : m === 'transfer'
      ? 'โอน'
      : m === 'promptpay'
      ? 'พร้อมเพย์'
      : m === 'card'
      ? 'บัตร'
      : 'อื่นๆ';

  return (
    <main className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">คิวหน้าบาร์</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/orders" className="underline">รายการบิล</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
          <button className="px-3 py-1 rounded-xl border" onClick={load}>รีเฟรช</button>
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
        {/* รอคิว */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">รอคิว ({queued.length})</div>
          <div className="space-y-2">
            {queued.map((t) => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {t.code}
                    <Link href={`/orders/${t.id}`} className="ml-2 text-xs underline">ดูบิล</Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => setQueue(t.id, 'preparing')}>
                      เริ่มทำ
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border text-red-600"
                      onClick={() => deleteOrder(t.id, t.code)}
                    >
                      ลบบิล
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  รับคิว: {new Date(t.opened_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {queued.length === 0 && <div className="text-gray-500 text-sm">ไม่มีคิว</div>}
          </div>
        </div>

        {/* กำลังทำ */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">กำลังทำ ({preparing.length})</div>
          <div className="space-y-2">
            {preparing.map((t) => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {t.code}
                    <Link href={`/orders/${t.id}`} className="ml-2 text-xs underline">ดูบิล</Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-2 py-1 rounded border" onClick={() => setQueue(t.id, 'done')}>
                      เสร็จแล้ว
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border text-red-600"
                      onClick={() => deleteOrder(t.id, t.code)}
                    >
                      ลบบิล
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
                <div className="text-xs text-gray-500 mt-1">
                  เริ่ม: {t.started_at ? new Date(t.started_at).toLocaleTimeString() : '-'}
                </div>
              </div>
            ))}
            {preparing.length === 0 && <div className="text-gray-500 text-sm">ไม่มีงาน</div>}
          </div>
        </div>

        {/* เสร็จแล้ว - ยังไม่จ่าย */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">เสร็จแล้ว — ยังไม่จ่าย ({doneUnpaid.length})</div>
          <div className="space-y-2">
            {doneUnpaid.map((t) => {
              const sub = subtotalOf(t);
              const discSaved = savedDiscount(t);
              const net = netOf(t);
              const prefillPct = sub > 0 ? Math.round(((discSaved / sub) * 100) * 10) / 10 : 0;
              const pct = discPctById[t.id] ?? prefillPct;

              return (
                <div key={t.id} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">
                      {t.code}
                      <Link href={`/orders/${t.id}`} className="ml-2 text-xs underline">ดูบิล</Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-1 rounded border" onClick={() => setQueue(t.id, 'void')}>
                        เคลียร์
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded border text-red-600"
                        onClick={() => deleteOrder(t.id, t.code)}
                      >
                        ลบบิล
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>

                  {/* เงิน */}
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-gray-500">รวม (Subtotal)</div>
                      <div>{fmtTHB(sub)} ฿</div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-gray-500">ส่วนลด</div>
                      <div>- {fmtTHB(discSaved)} ฿</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">ยอดสุทธิ</div>
                      <div className="text-lg font-semibold">{fmtTHB(net)} ฿</div>
                    </div>
                  </div>

                  {/* ส่วนลด % */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      className="text-xs border rounded px-2 py-1 w-28"
                      placeholder="ส่วนลด (%)"
                      value={Number.isFinite(pct) ? pct : 0}
                      onChange={(e) =>
                        setDiscPctById((prev) => ({
                          ...prev,
                          [t.id]: Number(e.target.value || 0),
                        }))
                      }
                    />
                    <button
                      className="text-xs px-3 py-1 rounded bg-black text-white"
                      onClick={() => saveDiscountPercent(t, pct)}
                    >
                      บันทึกส่วนลด
                    </button>
                  </div>

                  {/* รับเงิน */}
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      className="text-xs border rounded px-2 py-1"
                      value={methodById[t.id] || 'cash'}
                      onChange={(e) =>
                        setMethodById((prev) => ({
                          ...prev,
                          [t.id]: e.target.value as Method,
                        }))
                      }
                    >
                      <option value="cash">เงินสด</option>
                      <option value="transfer">โอน</option>
                      <option value="promptpay">พร้อมเพย์</option>
                      <option value="card">บัตร</option>
                      <option value="other">อื่นๆ</option>
                    </select>
                    <button
                      className="text-xs px-2 py-1 rounded bg-black text-white"
                      onClick={() => markPaid(t.id)}
                    >
                      รับเงิน
                    </button>
                  </div>

                  <div className="text-xs text-gray-500 mt-1">
                    เสร็จ: {t.done_at ? new Date(t.done_at).toLocaleTimeString() : '-'}
                  </div>
                </div>
              );
            })}
            {doneUnpaid.length === 0 && <div className="text-gray-500 text-sm">—</div>}
          </div>
        </div>

        {/* เสร็จแล้ว - จ่ายแล้ว */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">เสร็จแล้ว — จ่ายแล้ว ({donePaid.length})</div>
          <div className="space-y-2">
            {donePaid.map((t) => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {t.code}
                    <Link href={`/orders/${t.id}`} className="ml-2 text-xs underline">ดูบิล</Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => markUnpaid(t.id)}
                    >
                      แก้เป็นยังไม่จ่าย
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border text-red-600"
                      onClick={() => deleteOrder(t.id, t.code)}
                    >
                      ลบบิล
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="text-gray-500">รวม (Subtotal)</div>
                    <div>{fmtTHB(subtotalOf(t))} ฿</div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="text-gray-500">ส่วนลด</div>
                    <div>- {fmtTHB(savedDiscount(t))} ฿</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500">ยอดสุทธิ</div>
                    <div className="text-lg font-semibold">{fmtTHB(netOf(t))} ฿</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ชำระ: {t.paid_at ? new Date(t.paid_at).toLocaleTimeString() : '-'} ({methodLabel(t.paid_method)})
                </div>
              </div>
            ))}
            {donePaid.length === 0 && <div className="text-gray-500 text-sm">—</div>}
          </div>
        </div>
      </div>
    </main>
  );
}
