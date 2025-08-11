'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Product = { id: string; name: string; price: number; category: string | null };
type CartLine = { productId: string; name: string; unitPrice: number; qty: number };

export default function PosPage() {
  const supabase = createClient();

  // สินค้าจากฐานข้อมูล
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // ตะกร้า
  const [cart, setCart] = useState<CartLine[]>([]);
  const total = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart]
  );

  // โมดอลชำระเงิน
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<'cash' | 'transfer' | 'promptpay' | 'card' | 'other'>('cash');
  const [recv, setRecv] = useState<number | ''>(''); // รับเงินสด
  const change = useMemo(() => (method === 'cash' && typeof recv === 'number' ? recv - total : 0), [recv, total, method]);
  const [paying, setPaying] = useState(false);

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
  const inc = (id: string) => setCart((old) => old.map((l) => (l.productId === id ? { ...l, qty: l.qty + 1 } : l)));
  const dec = (id: string) =>
    setCart((old) =>
      old
        .map((l) => (l.productId === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  const removeLine = (id: string) => setCart((old) => old.filter((l) => l.productId !== id));
  const clearCart = () => setCart([]);

  // ชำระเงิน (สร้าง order -> items -> update order -> payment)
  const handlePay = async () => {
    try {
      if (cart.length === 0) return;
      if (method === 'cash' && (recv === '' || (recv as number) < total)) {
        alert('กรุณาใส่จำนวนเงินสดที่รับมาให้พอ');
        return;
      }
      setPaying(true);

      // 1) สร้างออเดอร์ (open)
      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .insert([{ status: 'open', note: null, total: 0 }])
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

      // 3) ปิดบิล (paid) + ใส่ total
      const totalFixed = Number(total.toFixed(2));
      const { error: updErr } = await supabase
        .from('orders')
        .update({ status: 'paid', total: totalFixed, closed_at: new Date().toISOString() })
        .eq('id', orderId);
      if (updErr) throw updErr;

      // 4) บันทึกการชำระเงิน
      const paidAmount = method === 'cash' ? (recv as number) : totalFixed; // โอน/พร้อมเพย์ถือว่าชำระเท่ายอด
      const { error: payErr } = await supabase.from('payments').insert([
        { order_id: orderId, method, amount: totalFixed, ref: method === 'cash' ? undefined : 'paid' },
      ]);
      if (payErr) throw payErr;

      // เสร็จ
      clearCart();
      setPayOpen(false);
      setRecv('');
      alert(`บิลสำเร็จ\nเลขบิล: ${orderRow!.code}\nยอดสุทธิ: ${totalFixed.toFixed(2)} บาท${method === 'cash' ? `\nรับมา: ${paidAmount.toFixed(2)} ทอน: ${change.toFixed(2)} บาท` : ''}`);
      // TODO: ไปหน้าใบเสร็จ/พิมพ์ ในขั้นตอนถัดไป
    } catch (e: any) {
      console.error(e);
      alert('ชำระเงินไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
    } finally {
      setPaying(false);
    }
  };

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-center">Si-Wara POS (MVP)</h1>
      <p className="text-xs text-gray-500 text-center">บูธเล็กๆ ใช้งานจริงก่อน ค่อยต่อยอด</p>

      {errMsg && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">
          เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {errMsg}
        </div>
      )}

      {!errMsg && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* สินค้า */}
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
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
              {cart.length === 0 && <div className="text-gray-400 text-sm">ยังไม่มีรายการ</div>}
              {cart.map((l) => (
                <div key={l.productId} className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-gray-500">{l.unitPrice.toFixed(2)} ฿</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 rounded border" onClick={() => dec(l.productId)}>-</button>
                    <div className="w-6 text-center">{l.qty}</div>
                    <button className="px-2 py-1 rounded border" onClick={() => inc(l.productId)}>+</button>
                  </div>
                  <div className="text-right w-20">{(l.unitPrice * l.qty).toFixed(2)}</div>
                  <button className="text-xs text-red-600" onClick={() => removeLine(l.productId)}>ลบ</button>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t pt-3 flex items-center justify-between">
              <div className="text-gray-600">รวม</div>
              <div className="text-xl font-semibold">{total.toFixed(2)} ฿</div>
            </div>

            <button
              className="w-full mt-3 py-3 rounded-2xl bg-black text-white disabled:opacity-40"
              onClick={() => setPayOpen(true)}
              disabled={cart.length === 0}
            >
              ชำระเงิน
            </button>
          </div>
        </div>
      )}

      {/* โมดอลชำระเงินแบบง่าย */}
      {payOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-5 w-[92vw] max-w-md">
            <div className="text-lg font-semibold mb-2">ชำระเงิน</div>
            <div className="text-sm text-gray-600 mb-4">ยอดสุทธิ {total.toFixed(2)} ฿</div>

            <label className="block text-sm mb-2">วิธีชำระ</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(['cash','transfer','promptpay','card','other'] as const).map((m) => (
                <button
                  key={m}
                  className={`border rounded-xl py-2 ${method === m ? 'bg-gray-900 text-white' : ''}`}
                  onClick={() => setMethod(m)}
                >
                  {m === 'cash' ? 'เงินสด' : m === 'transfer' ? 'โอน' : m === 'promptpay' ? 'พร้อมเพย์' : m === 'card' ? 'บัตร' : 'อื่นๆ'}
                </button>
              ))}
            </div>

            {method === 'cash' && (
              <div className="mb-4">
                <label className="block text-sm mb-1">รับเงินมา</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full border rounded-xl px-3 py-2"
                  value={recv}
                  onChange={(e) => setRecv(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <div className="text-sm mt-1">เงินทอน: <span className={change < 0 ? 'text-red-600' : ''}>{change.toFixed(2)} ฿</span></div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button className="px-4 py-2 rounded-xl border" onClick={() => setPayOpen(false)} disabled={paying}>ยกเลิก</button>
              <button className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-40" onClick={handlePay} disabled={paying}>
                {paying ? 'กำลังบันทึก…' : 'ยืนยันชำระ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
