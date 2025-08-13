'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/app/lib/supabase/client';

type Product = { id: string; name: string; price: number; category: string | null };
type CartLine = { productId: string; name: string; unitPrice: number; qty: number };

export default function PosPage() {
  const supabase = createClient();
  const router = useRouter();

  // สินค้า
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // ตะกร้า
  const [cart, setCart] = useState<CartLine[]>([]);
  const total = useMemo(() => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0), [cart]);

  // โน้ต/ชื่อบนแก้ว (เก็บลง orders.note)
  const [note, setNote] = useState('');

  // โหลดสินค้า
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id,name,price,category')
          .eq('is_active', true)
          .order('category', { ascending: true })
          .order('name', { ascending: true });
        if (error) throw error;
        setProducts(data || []);
      } catch (e: any) {
        setErrMsg(e?.message || 'โหลดสินค้าไม่สำเร็จ');
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // จัดการตะกร้า
  const addToCart = (p: Product) => {
    setCart((old) => {
      const i = old.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        const clone = [...old];
        clone[i] = { ...clone[i], qty: clone[i].qty + 1 };
        return clone;
      }
      return [...old, { productId: p.id, name: p.name, unitPrice: Number(p.price), qty: 1 }];
    });
  };
  const inc = (id: string) =>
    setCart((old) => old.map((l) => (l.productId === id ? { ...l, qty: l.qty + 1 } : l)));
  const dec = (id: string) =>
    setCart((old) =>
      old
        .map((l) => (l.productId === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  const removeLine = (id: string) => setCart((old) => old.filter((l) => l.productId !== id));
  const clearCart = () => setCart([]);

  // ส่งเข้าคิว (ไม่ทำบิล)
  const handleSendToQueue = async () => {
    try {
      if (cart.length === 0) return;

      const totalFixed = Number(total.toFixed(2));

      // 1) สร้างออเดอร์สถานะคิว = queued
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert([{ status: 'open', queue_status: 'queued', note: note || null, total: totalFixed }])
        .select('id, code')
        .single();
      if (orderErr) throw orderErr;
      const orderId = orderRow!.id;

      // 2) เพิ่มรายการสินค้า
      const itemsPayload = cart.map((l) => ({
        order_id: orderId,
        product_id: l.productId,
        qty: l.qty,
        unit_price: l.unitPrice,
        subtotal: Number((l.unitPrice * l.qty).toFixed(2)),
      }));
      const { error: itemsErr } = await supabase.from('order_items').insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      // 3) เคลียร์หน้าจอ แล้วพาไปหน้า /queue
      clearCart();
      setNote('');
      router.push('/queue');
    } catch (e: any) {
      console.error(e);
      alert('ส่งเข้าคิวไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
    }
  };

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Si-Wara POS (คิว)</h1>
        <div className="text-sm flex gap-3">
          <Link href="/queue" className="underline">ดูคิว</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
          <Link href="/stock" className="underline">สต๊อก</Link>
        </div>
      </div>
      <p className="text-xs text-gray-500">เลือกเมนู → ใส่ตะกร้า → กด “ส่งเข้าคิว”</p>

      {errMsg && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">
          เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {errMsg}
        </div>
      )}

      {!errMsg && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* รายการสินค้า */}
          <div className="md:col-span-2">
            {loading ? (
              <div>กำลังโหลด...</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {products.map((p) => (
                  <button
                    key={p.id}
                    className="border rounded-xl p-3 text-left hover:shadow transition"
                    onClick={() => addToCart(p)}
                    title="เพิ่มลงตะกร้า"
                  >
                    <div className="text-xs text-gray-500 mb-1">{p.category || 'ทั่วไป'}</div>
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-right">{Number(p.price).toFixed(2)} ฿</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ตะกร้า */}
          <div className="border rounded-2xl p-4">
            <div className="font-semibold mb-3">ตะกร้า</div>

            {/* รายการ */}
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
              {cart.length === 0 && <div className="text-gray-400 text-sm">ยังไม่มีรายการ</div>}
              {cart.map((l) => (
                <div
                  key={l.productId}
                  className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-gray-500">{l.unitPrice.toFixed(2)} ฿</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 rounded border" onClick={() => dec(l.productId)}>
                      -
                    </button>
                    <div className="w-6 text-center">{l.qty}</div>
                    <button className="px-2 py-1 rounded border" onClick={() => inc(l.productId)}>
                      +
                    </button>
                  </div>
                  <div className="text-right w-20">{(l.unitPrice * l.qty).toFixed(2)}</div>
                  <button className="text-xs text-red-600" onClick={() => removeLine(l.productId)}>
                    ลบ
                  </button>
                </div>
              ))}
            </div>

            {/* โน้ต/ชื่อบนแก้ว */}
            <div className="mt-3">
              <label className="text-sm">โน้ต / ชื่อบนแก้ว</label>
              <input
                className="mt-1 w-full border rounded-xl px-3 py-2"
                value={note}
                placeholder="เช่น 'ชาลี - หวานน้อย'"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {/* รวม + ปุ่มส่งเข้าคิว */}
            <div className="mt-3 border-t pt-3 flex items-center justify-between">
              <div className="text-gray-600">รวม</div>
              <div className="text-xl font-semibold">{total.toFixed(2)} ฿</div>
            </div>

            <button
              className="w-full mt-3 py-3 rounded-2xl bg-black text-white disabled:opacity-40"
              onClick={handleSendToQueue}
              disabled={cart.length === 0}
            >
              ส่งเข้าคิว
            </button>

            <div className="mt-3 text-xs text-right">
              <Link href="/queue" className="underline">ไปหน้า “คิวหน้าบาร์”</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
