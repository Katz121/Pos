'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Method = 'cash'|'transfer'|'promptpay'|'card'|'other';

type Ticket = {
  id: string;
  code: string;
  queue_status: 'queued'|'preparing'|'done'|'void';
  opened_at: string;
  started_at: string | null;
  done_at: string | null;
  payment_status: 'unpaid'|'paid';
  paid_at: string | null;
  paid_method: Method | null;
  order_items: { qty: number; products: { name: string } | null }[];
};

export default function QueuePage() {
  const supabase = createClient();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // method per ticket (สำหรับเลือกตอนกดรับเงิน)
  const [methodById, setMethodById] = useState<Record<string, Method>>({});

  const HORIZON_HOURS = 12;        // แสดงคิววันนี้
  const DONE_VISIBLE_MIN = 60;     // แสดงรายการเสร็จแล้วเป็นเวลา 60 นาที

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const since = new Date(Date.now() - HORIZON_HOURS*60*60*1000).toISOString();
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, code, queue_status, opened_at, started_at, done_at,
          payment_status, paid_at, paid_method,
          order_items ( qty, products(name) )
        `)
        .gte('opened_at', since)
        .in('queue_status', ['queued','preparing','done'] as any)
        .order('opened_at', { ascending: true });

      if (error) throw error;
      setTickets((data || []) as any);
    } catch (e: any) {
      setErr(e?.message || 'โหลดคิวไม่สำเร็จ');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const queued = useMemo(() => tickets.filter(t => t.queue_status === 'queued'), [tickets]);
  const preparing = useMemo(() => tickets.filter(t => t.queue_status === 'preparing'), [tickets]);
  const doneUnpaid = useMemo(() => {
    const limit = Date.now() - DONE_VISIBLE_MIN*60*1000;
    return tickets.filter(t =>
      t.queue_status === 'done' &&
      t.payment_status === 'unpaid' &&
      (!t.done_at || new Date(t.done_at).getTime() >= limit)
    );
  }, [tickets]);
  const donePaid = useMemo(() => {
    const limit = Date.now() - DONE_VISIBLE_MIN*60*1000;
    return tickets.filter(t =>
      t.queue_status === 'done' &&
      t.payment_status === 'paid' &&
      (!t.done_at || new Date(t.done_at).getTime() >= limit)
    );
  }, [tickets]);

  const toLine = (t: Ticket) =>
    t.order_items.map(it => `${it.products?.name ?? '-'} × ${it.qty}`).join(' • ');

  const setQueue = async (id: string, next: Ticket['queue_status']) => {
    const patch: any = { queue_status: next };
    if (next === 'preparing') patch.started_at = new Date().toISOString();
    if (next === 'done')      patch.done_at    = new Date().toISOString();
    const { error } = await supabase.from('orders').update(patch).eq('id', id);
    if (error) { alert(error.message); return; }
    await load();
  };

  const markPaid = async (id: string) => {
    const method = methodById[id] || 'cash';
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'paid', paid_at: new Date().toISOString(), paid_method: method })
      .eq('id', id);
    if (error) { alert(error.message); return; }
    await load();
  };

  const markUnpaid = async (id: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'unpaid', paid_at: null, paid_method: null })
      .eq('id', id);
    if (error) { alert(error.message); return; }
    await load();
  };

  const methodLabel = (m?: Method | null) =>
    m === 'cash' ? 'เงินสด' :
    m === 'transfer' ? 'โอน' :
    m === 'promptpay' ? 'พร้อมเพย์' :
    m === 'card' ? 'บัตร' : 'อื่นๆ';

  return (
    <main className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">คิวหน้าบาร์</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
          <button className="px-3 py-1 rounded-xl border" onClick={load}>รีเฟรช</button>
        </div>
      </div>

      {err && <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
        {/* รอคิว */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">รอคิว ({queued.length})</div>
          <div className="space-y-2">
            {queued.map(t => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.code}</div>
                  <button className="text-xs px-2 py-1 rounded border" onClick={()=>setQueue(t.id,'preparing')}>เริ่มทำ</button>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
                <div className="text-xs text-gray-500 mt-1">รับคิว: {new Date(t.opened_at).toLocaleTimeString()}</div>
              </div>
            ))}
            {queued.length === 0 && <div className="text-gray-500 text-sm">ไม่มีคิว</div>}
          </div>
        </div>

        {/* กำลังทำ */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">กำลังทำ ({preparing.length})</div>
          <div className="space-y-2">
            {preparing.map(t => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.code}</div>
                  <button className="text-xs px-2 py-1 rounded border" onClick={()=>setQueue(t.id,'done')}>เสร็จแล้ว</button>
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
            {doneUnpaid.map(t => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.code}</div>
                  <button className="text-xs px-2 py-1 rounded border" onClick={()=>setQueue(t.id,'void')}>เคลียร์</button>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
                <div className="flex items-center gap-2 mt-2">
                  <select
                    className="text-xs border rounded px-2 py-1"
                    value={methodById[t.id] || 'cash'}
                    onChange={e => setMethodById(prev => ({ ...prev, [t.id]: e.target.value as Method }))}
                  >
                    <option value="cash">เงินสด</option>
                    <option value="transfer">โอน</option>
                    <option value="promptpay">พร้อมเพย์</option>
                    <option value="card">บัตร</option>
                    <option value="other">อื่นๆ</option>
                  </select>
                  <button className="text-xs px-2 py-1 rounded bg-black text-white" onClick={()=>markPaid(t.id)}>
                    รับเงิน
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-1">เสร็จ: {t.done_at ? new Date(t.done_at).toLocaleTimeString() : '-'}</div>
              </div>
            ))}
            {doneUnpaid.length === 0 && <div className="text-gray-500 text-sm">—</div>}
          </div>
        </div>

        {/* เสร็จแล้ว - จ่ายแล้ว */}
        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">เสร็จแล้ว — จ่ายแล้ว ({donePaid.length})</div>
          <div className="space-y-2">
            {donePaid.map(t => (
              <div key={t.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.code}</div>
                  <button className="text-xs px-2 py-1 rounded border" onClick={()=>markUnpaid(t.id)}>
                    แก้เป็นยังไม่จ่าย
                  </button>
                </div>
                <div className="text-sm text-gray-700 mt-1">{toLine(t)}</div>
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
