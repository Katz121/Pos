'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client'; // ✅ แก้ path ให้ชัด

type Method = 'cash' | 'transfer' | 'promptpay' | 'card' | 'other';

type ItemRow = {
  qty: number;
  unit_price: number | null;
  subtotal: number | null;
  products: { name: string; sku?: string | null } | null;
};

// ✅ เปลี่ยนชื่อ type เป็น OrderDetail กันสับสน/ชนกับ type อื่น
type OrderDetail = {
  id: string;
  code: string | null;
  opened_at: string;
  started_at: string | null;
  done_at: string | null;
  payment_status: 'paid' | 'unpaid';
  paid_at: string | null;
  paid_method: Method | null;
  discount_amount: number | null;
  total: number | null; // ยอดสุทธิ
  order_items: ItemRow[];
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id; // ป้องกันกรณีไม่พบ id
  const supabase = useMemo(() => createClient(), []);

  const [ord, setOrd] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const fmtTHB = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const methodLabel = (m?: Method | null) =>
    m === 'cash'
      ? 'เงินสด'
      : m === 'transfer'
      ? 'โอน'
      : m === 'promptpay'
      ? 'พร้อมเพย์'
      : m === 'card'
      ? 'บัตร'
      : m === 'other'
      ? 'อื่นๆ'
      : '-';

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      setErr(null);

      // ✅ บอกชนิดผลลัพธ์ให้ชัด และใช้ maybeSingle() → data: OrderDetail | null
      const { data, error }: { data: OrderDetail | null; error: any } = await supabase
        .from('orders')
        .select(`
          id, code, opened_at, started_at, done_at,
          payment_status, paid_at, paid_method,
          discount_amount, total,
          order_items ( qty, unit_price, subtotal, products(name, sku) )
        `)
        .eq('id', orderId)
        .maybeSingle();

      if (error) throw error;
      setOrd(data); // ✅ ไม่ต้อง cast
    } catch (e: any) {
      setErr(e?.message || 'ไม่พบบิลนี้');
    } finally {
      setLoading(false);
    }
  }, [supabase, orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const subtotal = useMemo(() => {
    if (!ord) return 0;
    return ord.order_items.reduce(
      (s, it) => s + Number(it.subtotal ?? ((it.unit_price || 0) * it.qty)),
      0
    );
  }, [ord]);

  const printSlip = () => window.print();

  if (loading) return <main className="p-6 max-w-3xl mx-auto">กำลังโหลด…</main>;

  if (err)
    return (
      <main className="p-6 max-w-3xl mx-auto">
        <div className="mb-3">
          <Link href="/orders" className="underline">
            ← กลับรายการบิล
          </Link>
        </div>
        <div className="rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>
      </main>
    );

  if (!ord) return null;

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/orders" className="underline">
          ← กลับรายการบิล
        </Link>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-xl border" onClick={load}>
            รีเฟรช
          </button>
          <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={printSlip}>
            พิมพ์ใบเสร็จ
          </button>
        </div>
      </div>

      {/* ใบเสร็จ (เข้ากับ CSS @media print ของคุณ) */}
      <div className="receipt border rounded-2xl p-4">
        <div className="text-center">
          <div className="text-lg font-bold">Si-Wara POS</div>
          <div className="text-xs text-gray-500">บิลขาย</div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
          <div>
            รหัสบิล: <span className="font-medium">{ord.code || ord.id.slice(0, 8)}</span>
          </div>
          <div className="text-right">เปิดบิล: {new Date(ord.opened_at).toLocaleString()}</div>
          <div>
            สถานะชำระ:{' '}
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                ord.payment_status === 'paid'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {ord.payment_status === 'paid' ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
            </span>
          </div>
          <div className="text-right">
            ชำระเมื่อ: {ord.paid_at ? new Date(ord.paid_at).toLocaleString() : '-'}
          </div>
          <div>ช่องทาง: {methodLabel(ord.paid_method)}</div>
        </div>

        {/* รายการสินค้า */}
        <div className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1">รายการ</th>
                <th className="text-right py-1">จำนวน</th>
                <th className="text-right py-1">ราคา/หน่วย</th>
                <th className="text-right py-1">รวม</th>
              </tr>
            </thead>
            <tbody>
              {ord.order_items.map((it, idx) => (
                <tr key={idx} className="border-b">
                  <td className="py-1">{it.products?.name || '-'}</td>
                  <td className="py-1 text-right">{it.qty}</td>
                  <td className="py-1 text-right">{fmtTHB(Number(it.unit_price || 0))}</td>
                  <td className="py-1 text-right">
                    {fmtTHB(Number(it.subtotal ?? (Number(it.unit_price || 0) * it.qty)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* สรุปเงิน */}
        <div className="mt-3 text-sm">
          <div className="flex justify-between">
            <div>รวม (Subtotal)</div>
            <div>{fmtTHB(subtotal)} ฿</div>
          </div>
          <div className="flex justify-between">
            <div>ส่วนลด</div>
            <div>- {fmtTHB(Number(ord.discount_amount || 0))} ฿</div>
          </div>
          <div className="flex justify-between border-t mt-1 pt-1 font-semibold">
            <div>ยอดสุทธิ</div>
            <div>{fmtTHB(Number(ord.total || 0))} ฿</div>
          </div>
        </div>

        <div className="mt-3 text-center text-xs text-gray-500">ขอบคุณที่อุดหนุน 🙏</div>
      </div>
    </main>
  );
}
