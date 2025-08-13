'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';

type Order = {
  id: string;
  total: number | null;
  paid_at: string | null;
  status: 'paid'|'open'|'void'|'refunded';
  payment_status: 'paid'|'unpaid';
  paid_method: 'cash'|'transfer'|'promptpay'|'card'|'other'|null;
};
type Payment = { order_id: string; method: 'cash'|'transfer'|'promptpay'|'card'|'other'; amount: number };
type ItemRow = { order_id: string; product_id: string; qty: number; subtotal: number; products: { name: string } | null };

type Summary = { bills: number; sales: number; avgBill: number };
type MethodSum = { method: NonNullable<Order['paid_method']>; amount: number };
type TopProduct = { product_id: string; name: string; qty: number; revenue: number };
type DayRow = { date: string; bills: number; sales: number; avgBill: number };

const toDateInput = (d: Date) => {
  const z = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
};
const startOfDayISO = (d: Date) => { const t=new Date(d); t.setHours(0,0,0,0); return t.toISOString(); };
const endOfDayISO = (d: Date) => { const t=new Date(d); t.setHours(23,59,59,999); return t.toISOString(); };
const shortTH = (d: Date) => d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});

export default function ReportsPage() {
  const supabase = createClient();

  const today = useMemo(()=> new Date(), []);
  const [fromStr, setFromStr] = useState<string>(toDateInput(today));
  const [toStr,   setToStr]   = useState<string>(toDateInput(today));

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary>({ bills: 0, sales: 0, avgBill: 0 });
  const [byMethod, setByMethod] = useState<MethodSum[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [byDay, setByDay] = useState<DayRow[]>([]);

  const applyQuick = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days-1));
    setFromStr(toDateInput(start));
    setToStr(toDateInput(end));
  };

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);

      const fromISO = startOfDayISO(new Date(fromStr));
      const toISO   = endOfDayISO(new Date(toStr));

      // 1) Orders — ใช้ paid_at เป็นหลัก + เงื่อนไขสถานะ paid
      const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id,total,paid_at,status,payment_status,paid_method')
        .or('status.eq.paid,payment_status.eq.paid')   // อย่างใดอย่างหนึ่งเป็น paid
        .gte('paid_at', fromISO)                       // อยู่ในช่วงจ่ายเงิน
        .lte('paid_at', toISO)
        .order('paid_at', { ascending: true }) as unknown as { data: Order[], error: any };
      if (ordErr) throw ordErr;

      const orderIds = orders.map(o => o.id);
      const bills = orders.length;
      const sales = orders.reduce((s,o)=>s + Number(o.total||0), 0);
      const avgBill = bills ? sales / bills : 0;
      setSummary({ bills, sales, avgBill });

      // 2) By day (อิง paid_at)
      const dayMap = new Map<string, {bills:number; sales:number;}>();
      orders.forEach(o => {
        const key = o.paid_at ? o.paid_at.slice(0,10) : '';
        if (!key) return;
        const cur = dayMap.get(key) || { bills: 0, sales: 0 };
        cur.bills += 1;
        cur.sales += Number(o.total||0);
        dayMap.set(key, cur);
      });
      const dayRows: DayRow[] = Array.from(dayMap.entries())
        .sort(([a],[b])=>a.localeCompare(b))
        .map(([date, v]) => ({ date, bills: v.bills, sales: v.sales, avgBill: v.bills ? v.sales/v.bills : 0 }));
      setByDay(dayRows);

      if (orderIds.length === 0) {
        setByMethod([]);
        setTopProducts([]);
        return;
      }

      // 3) Payments by method (ถ้ามีตาราง payments)
      const { data: pays, error: payErr } = await supabase
        .from('payments')
        .select('order_id, method, amount')
        .in('order_id', orderIds) as unknown as { data: Payment[]|null, error: any };

      let methodRows: MethodSum[] = [];
      if (!payErr && pays && pays.length > 0) {
        const methodMap = new Map<NonNullable<Order['paid_method']>, number>();
        pays.forEach(p => methodMap.set(p.method, (methodMap.get(p.method)||0) + Number(p.amount||0)));
        methodRows = Array.from(methodMap.entries())
          .map(([method, amount]) => ({ method, amount }))
          .sort((a,b)=> b.amount - a.amount);
      } else {
        // ⭐ Fallback: ถ้าไม่มี payments ให้สรุปจาก orders.paid_method แทน
        const m2 = new Map<NonNullable<Order['paid_method']>, number>();
        orders.forEach(o => {
          if (!o.paid_method) return;
          m2.set(o.paid_method, (m2.get(o.paid_method)||0) + Number(o.total||0));
        });
        methodRows = Array.from(m2.entries())
          .map(([method, amount]) => ({ method, amount }))
          .sort((a,b)=> b.amount - a.amount);
      }
      setByMethod(methodRows);

      // 4) Top products (จากรายการในบิลที่เลือก)
      const { data: items, error: itemsErr } = await supabase
        .from('order_items')
        .select('order_id, product_id, qty, subtotal, products(name)')
        .in('order_id', orderIds) as unknown as { data: ItemRow[], error: any };
      if (itemsErr) throw itemsErr;

      const prodMap = new Map<string, TopProduct>();
      items.forEach(it => {
        const key = it.product_id;
        const cur = prodMap.get(key) || { product_id: key, name: it.products?.name || '-', qty: 0, revenue: 0 };
        cur.qty += Number(it.qty||0);
        cur.revenue += Number(it.subtotal||0);
        prodMap.set(key, cur);
      });
      const top = Array.from(prodMap.values())
        .sort((a,b)=> b.qty - a.qty)
        .slice(0, 15);
      setTopProducts(top);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || 'โหลดรายงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const methodLabel = (m: NonNullable<Order['paid_method']>) =>
    m==='cash'?'เงินสด':m==='transfer'?'โอน':m==='promptpay'?'พร้อมเพย์':m==='card'?'บัตร':'อื่นๆ';

  const exportCSV = () => {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };

    const lines: string[] = [];
    lines.push(['ช่วง', fromStr, toStr, 'สร้างเมื่อ', new Date().toLocaleString()].map(esc).join(',')); lines.push('');
    lines.push(['สรุปยอด', 'จำนวนบิล', 'ยอดขายรวม(฿)', 'เฉลี่ย/บิล(฿)'].map(esc).join(','));
    lines.push(['', summary.bills, summary.sales.toFixed(2), summary.avgBill.toFixed(2)].map(esc).join(',')); lines.push('');

    lines.push(['ยอดตามวิธีชำระเงิน'].map(esc).join(','));
    lines.push(['ช่องทาง','ยอด(฿)'].map(esc).join(','));
    byMethod.forEach(m => lines.push([methodLabel(m.method), m.amount.toFixed(2)].map(esc).join(','))); lines.push('');

    lines.push(['เมนูขายดี (Top 15)'].map(esc).join(','));
    lines.push(['เมนู','จำนวน','ยอดขาย(฿)'].map(esc).join(','));
    topProducts.forEach(p => lines.push([p.name, p.qty, p.revenue.toFixed(2)].map(esc).join(','))); lines.push('');

    lines.push(['สรุปรายวัน'].map(esc).join(','));
    lines.push(['วันที่','บิล','ยอดขาย(฿)','เฉลี่ย/บิล(฿)'].map(esc).join(','));
    byDay.forEach(d => lines.push([d.date, d.bills, d.sales.toFixed(2), d.avgBill.toFixed(2)].map(esc).join(',')));

    const csv = '\ufeff' + lines.join('\n'); // BOM เพื่อ Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `รายงาน_${fromStr}_${toStr}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const methodTotal = byMethod.reduce((s,m)=>s+m.amount,0);
  const methodGap = Math.abs(Number((summary.sales - methodTotal).toFixed(2)));

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">รายงานยอดขาย</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">ไปหน้า POS</Link>
          <Link href="/shift" className="underline">ไปหน้า กะการขาย</Link>
        </div>
      </div>

      {/* ฟิลเตอร์วันที่ + ปุ่ม */}
      <div className="mt-4 border rounded-2xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-sm">ตั้งแต่</label>
            <input type="date" className="w-full border rounded-xl px-3 py-2"
              value={fromStr} onChange={e=>setFromStr(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">ถึง</label>
            <input type="date" className="w-full border rounded-xl px-3 py-2"
              value={toStr} onChange={e=>setToStr(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="border rounded-xl px-3 py-2" onClick={()=>applyQuick(1)}>วันนี้</button>
            <button className="border rounded-xl px-3 py-2" onClick={()=>applyQuick(7)}>7 วัน</button>
            <button className="border rounded-xl px-3 py-2" onClick={()=>applyQuick(30)}>30 วัน</button>
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={load} disabled={loading}>
              {loading ? 'กำลังโหลด…' : 'ดูรายงาน'}
            </button>
            <button className="px-4 py-2 rounded-xl border" onClick={exportCSV} disabled={loading}>
              ส่งออก CSV
            </button>
          </div>
        </div>
      </div>

      {err && <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">
        เกิดข้อผิดพลาด: {err}
      </div>}

      {/* การ์ดสรุป */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <div className="border rounded-2xl p-4">
          <div className="text-sm text-gray-500">ช่วง</div>
          <div className="font-semibold">{shortTH(new Date(fromStr))} – {shortTH(new Date(toStr))}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-sm text-gray-500">จำนวนบิล</div>
          <div className="text-2xl font-bold">{summary.bills.toLocaleString()}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-sm text-gray-500">ยอดขายรวม</div>
          <div className="text-2xl font-bold">{summary.sales.toFixed(2)} ฿</div>
          <div className="text-xs text-gray-500">เฉลี่ย/บิล {summary.avgBill.toFixed(2)} ฿</div>
        </div>
      </div>

      {/* วิธีชำระเงิน + เมนูขายดี */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-2xl p-4">
          <div className="font-semibold mb-2">ยอดตามวิธีชำระเงิน</div>
          {byMethod.length === 0 ? (
            <div className="text-gray-500 text-sm">ไม่มีข้อมูล</div>
          ) : (
            <div className="space-y-1">
              {byMethod.map((m,i)=>(
                <div key={i} className="flex justify-between">
                  <div>{methodLabel(m.method)}</div>
                  <div>{m.amount.toFixed(2)} ฿</div>
                </div>
              ))}
              <div className="border-t mt-2 pt-2 flex justify-between font-medium">
                <div>รวมช่องทาง</div>
                <div>{byMethod.reduce((s,m)=>s+m.amount,0).toFixed(2)} ฿</div>
              </div>
              {methodGap > 0.009 && (
                <div className="text-xs text-amber-600 mt-1">
                  *ยอดรวมช่องทางต่างกับยอดขายทั้งหมด {methodGap.toFixed(2)} ฿
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border rounded-2xl p-4">
          <div className="font-semibold mb-2">เมนูขายดี (Top 15)</div>
          {topProducts.length === 0 ? (
            <div className="text-gray-500 text-sm">ไม่มีข้อมูล</div>
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left">
                    <th className="py-1 pr-2">เมนู</th>
                    <th className="py-1 pr-2 text-right">จำนวน</th>
                    <th className="py-1 pr-2 text-right">ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p)=>(
                    <tr key={p.product_id} className="border-t">
                      <td className="py-1 pr-2">{p.name}</td>
                      <td className="py-1 pr-2 text-right">{p.qty}</td>
                      <td className="py-1 pr-2 text-right">{p.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* รายวัน */}
      <div className="mt-6 border rounded-2xl p-4">
        <div className="font-semibold mb-2">สรุปรายวัน</div>
        {byDay.length === 0 ? (
          <div className="text-gray-500 text-sm">ไม่มีข้อมูล</div>
        ) : (
          <div className="max-h-[45vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left">
                  <th className="py-1 pr-2">วันที่</th>
                  <th className="py-1 pr-2 text-right">บิล</th>
                  <th className="py-1 pr-2 text-right">ยอดขาย</th>
                  <th className="py-1 pr-2 text-right">เฉลี่ย/บิล</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d)=>(
                  <tr key={d.date} className="border-t">
                    <td className="py-1 pr-2">{shortTH(new Date(d.date))}</td>
                    <td className="py-1 pr-2 text-right">{d.bills}</td>
                    <td className="py-1 pr-2 text-right">{d.sales.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right">{d.avgBill.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-1 pr-2">รวม</td>
                  <td className="py-1 pr-2 text-right">
                    {byDay.reduce((s,r)=>s+r.bills,0)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {byDay.reduce((s,r)=>s+r.sales,0).toFixed(2)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {(() => {
                      const b = byDay.reduce((s,r)=>s+r.bills,0);
                      const s = byDay.reduce((s2,r)=>s2+r.sales,0);
                      return b ? (s/b).toFixed(2) : '0.00';
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
