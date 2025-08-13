'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';

type Method = 'cash'|'transfer'|'promptpay'|'card'|'other';
type OrderRow = {
  id: string;
  code: string | null;
  opened_at: string;
  paid_at: string | null;
  total: number | null;
  payment_status: 'paid'|'unpaid';
  status?: 'paid'|'open'|'void'|'refunded'|null;
  paid_method: Method | null;
};

const toDateInput = (d: Date) => {
  const z = (n:number)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
};

export default function OrdersPage() {
  const supabase = useMemo(()=> createClient(), []);
  const [items, setItems] = useState<OrderRow[]>([]);
  const [q, setQ] = useState('');
  const [fromStr, setFromStr] = useState(toDateInput(new Date()));
  const [toStr, setToStr] = useState(toDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const startOfDayISO = (d: Date) => { const t=new Date(d); t.setHours(0,0,0,0); return t.toISOString(); };
  const endOfDayISO   = (d: Date) => { const t=new Date(d); t.setHours(23,59,59,999); return t.toISOString(); };

  const load = useCallback(async () => {
    try {
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from('orders')
        .select('id, code, opened_at, paid_at, total, payment_status, status, paid_method')
        .gte('opened_at', startOfDayISO(new Date(fromStr)))
        .lte('opened_at', endOfDayISO(new Date(toStr)))
        .order('opened_at', { ascending: false });
      if (error) throw error;
      setItems((data || []) as OrderRow[]);
    } catch (e:any) {
      setErr(e?.message || 'โหลดรายการบิลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [supabase, fromStr, toStr]);

  useEffect(()=>{ load(); }, [load]);

  const filtered = items.filter(o => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const code = (o.code ?? '').toLowerCase();
    const id6  = o.id.slice(0,8).toLowerCase();
    return code.includes(t) || id6.includes(t);
  });

  const methodLabel = (m?: Method|null) =>
    m==='cash'?'เงินสด':m==='transfer'?'โอน':m==='promptpay'?'พร้อมเพย์':m==='card'?'บัตร':m==='other'?'อื่นๆ':'-';

  return (
    <main className="max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">รายการบิล</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
        </div>
      </div>

      {err && <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>}

      {/* ฟิลเตอร์ */}
      <div className="mt-4 border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
        <div>
          <label className="text-sm">ตั้งแต่</label>
          <input type="date" className="w-full border rounded-xl px-3 py-2" value={fromStr} onChange={e=>setFromStr(e.target.value)} />
        </div>
        <div>
          <label className="text-sm">ถึง</label>
          <input type="date" className="w-full border rounded-xl px-3 py-2" value={toStr} onChange={e=>setToStr(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-sm">ค้นหา (รหัสบิล/ID)</label>
          <input className="w-full border rounded-xl px-3 py-2" placeholder="เช่น A012 หรือ ส่วนหนึ่งของ ID" value={q} onChange={e=>setQ(e.target.value)} />
        </div>
        <div className="flex gap-2 justify-end">
          <button className="px-3 py-2 rounded-xl border" onClick={load} disabled={loading}>{loading?'กำลังโหลด…':'ค้นหา'}</button>
        </div>
      </div>

      {/* ตาราง */}
      <div className="mt-4 border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-neutral-800">
            <tr className="text-left">
              <th className="py-2 px-3">เวลาเปิดบิล</th>
              <th className="py-2 px-3">รหัสบิล</th>
              <th className="py-2 px-3">สถานะชำระ</th>
              <th className="py-2 px-3">ช่องทาง</th>
              <th className="py-2 px-3 text-right">ยอดสุทธิ</th>
              <th className="py-2 px-3 text-right">ดู</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td className="py-3 px-3 text-gray-500" colSpan={6}>ไม่พบบิล</td></tr>}
            {filtered.map(o => (
              <tr key={o.id} className="border-t">
                <td className="py-2 px-3">{new Date(o.opened_at).toLocaleString()}</td>
                <td className="py-2 px-3 font-medium">{o.code || o.id.slice(0,8)}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${o.payment_status==='paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {o.payment_status==='paid' ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
                  </span>
                </td>
                <td className="py-2 px-3">{methodLabel(o.paid_method)}</td>
                <td className="py-2 px-3 text-right">{Number(o.total||0).toFixed(2)} ฿</td>
                <td className="py-2 px-3 text-right">
                  <Link href={`/orders/${o.id}`} className="px-2 py-1 rounded border">เปิดดู</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
