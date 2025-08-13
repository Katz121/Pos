'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/app/lib/supabase/client';
import Link from 'next/link';


type ItemRow = {
  product_id: string; qty: number; unit_price: number; subtotal: number;
  products: { name: string } | null;
};
type PaymentRow = { method: 'cash'|'transfer'|'promptpay'|'card'|'other'; amount: number; paid_at: string };
type OrderData = {
  id: string; code: string; total: number; closed_at: string | null;
  order_items: ItemRow[]; payments: PaymentRow[];
};

const SHOP = {
  name: 'ศิวราคาเฟ่',
  addr1: 'ตะกั่วป่า, พังงา',
  phone: '',
  taxid: '',
};

const methodText = (m: PaymentRow['method']) =>
  m === 'cash' ? 'เงินสด' :
  m === 'transfer' ? 'โอน' :
  m === 'promptpay' ? 'พร้อมเพย์' :
  m === 'card' ? 'บัตร' : 'อื่นๆ';

export default function ReceiptPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const sp = useSearchParams();

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select(`
            id, code, total, closed_at,
            order_items (
              product_id, qty, unit_price, subtotal,
              products ( name )
            ),
            payments (
              method, amount, paid_at
            )
          `)
          .eq('id', params.id)
          .single();
        if (error) throw error;
        setOrder(data as unknown as OrderData);
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || 'โหลดใบเสร็จไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  useEffect(() => {
    if (sp.get('print') === '1') {
      setTimeout(() => window.print(), 300);
    }
  }, [sp]);

  const totalQty = useMemo(
    () => (order?.order_items || []).reduce((s, r) => s + r.qty, 0),
    [order]
  );

  if (loading) return <div className="p-6">กำลังโหลดใบเสร็จ…</div>;
  if (err) return <div className="p-6 text-red-600">เกิดข้อผิดพลาด: {err}</div>;
  if (!order) return <div className="p-6">ไม่พบบิล</div>;

  return (
    <main className="p-4 flex justify-center">
      <div className="receipt w-[72mm] text-sm leading-5 print:w-auto">
        <div className="text-center">
          <div className="font-bold text-base">{SHOP.name}</div>
          {SHOP.addr1 && <div>{SHOP.addr1}</div>}
          {SHOP.phone && <div>โทร {SHOP.phone}</div>}
          {SHOP.taxid && <div>เลขผู้เสียภาษี {SHOP.taxid}</div>}
          <div className="mt-1">ใบเสร็จอย่างย่อ</div>
        </div>

        <div className="mt-2 border-t border-dashed" />
        <div className="flex justify-between mt-1">
          <div>เลขบิล: {order.code}</div>
          <div>{new Date(order.closed_at || Date.now()).toLocaleString()}</div>
        </div>
        <div className="border-b border-dashed mb-2" />

        <div className="space-y-1">
          {order.order_items.map((it, idx) => (
            <div key={idx}>
              <div className="flex justify-between">
                <div className="w-[52mm] truncate">{it.products?.name || '-'}</div>
                <div className="text-right w-[18mm]">{it.subtotal.toFixed(2)}</div>
              </div>
              <div className="text-xs text-gray-600 flex justify-between">
                <div>{it.qty} x {it.unit_price.toFixed(2)}</div>
                <div></div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed mt-2" />

        <div className="mt-2">
          <div className="flex justify-between">
            <div>จำนวนรายการ</div>
            <div>{totalQty}</div>
          </div>
          <div className="flex justify-between font-semibold text-base">
            <div>ยอดสุทธิ</div>
            <div>{order.total.toFixed(2)} ฿</div>
          </div>
        </div>

        <div className="mt-2 space-y-1">
          {order.payments.map((p, i) => (
            <div key={i} className="flex justify-between">
              <div>ชำระด้วย {methodText(p.method)}</div>
              <div>{p.amount.toFixed(2)} ฿</div>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed my-2" />

        <div className="text-center text-xs">
          ขอบคุณที่อุดหนุน 🙏<br />พบกันใหม่ที่ {SHOP.name}
        </div>

        <div className="no-print mt-4 flex gap-2">
          <button onClick={() => window.print()} className="px-3 py-2 rounded border">พิมพ์</button>
          <a href="/pos" className="px-3 py-2 rounded border">บิลใหม่</a>
        </div>
      </div>

        <div className="no-print mt-4 flex gap-2">
        <button onClick={() => window.print()} className="px-3 py-2 rounded border">พิมพ์</button>
        <Link href="/" className="px-3 py-2 rounded border">หน้าแรก</Link>
        <Link href="/pos" className="px-3 py-2 rounded border">กลับ POS</Link>
        </div>
    </main>

    
  );
}
