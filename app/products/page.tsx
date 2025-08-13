// app/products/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';

type Product = {
  id: string;
  name: string;
  price: number | null;
  sku: string | null;
  category: string | null;
  is_active: boolean | null;
  created_at?: string | null;
};

type Form = {
  id?: string;
  name: string;
  price: string;      // เก็บเป็น string ในฟอร์ม
  sku: string;
  category: string;
  is_active: boolean;
};

const emptyForm: Form = {
  name: '',
  price: '',
  sku: '',
  category: '',
  is_active: true,
};

export default function ProductsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase
        .from('products')
        .select('id,name,price,sku,category,is_active,created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data || []);
    } catch (e: any) {
      setErr(e?.message || 'โหลดรายการเมนูไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const validate = (): string | null => {
    if (!form.name.trim()) return 'กรุณาใส่ชื่อเมนู';
    const p = Number(form.price);
    if (!Number.isFinite(p) || p < 0) return 'ราคาต้องเป็นตัวเลข 0 ขึ้นไป';
    if (!form.sku.trim()) return 'กรุณาใส่รหัสสินค้า (SKU)';
    return null;
  };

  const onSubmit = async () => {
    const v = validate();
    if (v) { alert(v); return; }
    try {
      setLoading(true);
      setErr(null);

      const payload = {
        id: form.id, // ถ้ามี = แก้ไข, ถ้าไม่มี = เพิ่มใหม่
        name: form.name.trim(),
        price: Number(form.price),
        sku: form.sku.trim(),
        category: form.category.trim() || null,
        is_active: !!form.is_active,
      };

      // ใช้ upsert เพื่อกันเคส SKU ซ้ำ (ต้องมี unique index ที่ sku)
      const { error } = await supabase
        .from('products')
        .upsert(payload, { onConflict: 'sku' })
        .select()
        .single();
      if (error) throw error;

      setForm({ ...emptyForm });
      await load();
      alert('บันทึกเมนูเรียบร้อย');
    } catch (e: any) {
      setErr(e?.message || 'บันทึกไม่สำเร็จ');
      alert('บันทึกไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
    } finally {
      setLoading(false);
    }
  };

  const onEdit = (p: Product) => {
    setForm({
      id: p.id,
      name: p.name ?? '',
      price: (p.price ?? 0).toString(),
      sku: p.sku ?? '',
      category: p.category ?? '',
      is_active: !!p.is_active,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onToggle = async (p: Product) => {
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: !p.is_active })
        .eq('id', p.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + (e?.message || ''));
    }
  };

  const onDelete = async (p: Product) => {
    if (!confirm(`ลบเมนู "${p.name}" ?\nแนะนำให้ปิดการขายแทน หากมีการอ้างอิงยอดขาย/สูตร`)) return;
    try {
      const { error } = await supabase.from('products').delete().eq('id', p.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert('ลบไม่สำเร็จ: ' + (e?.message || ''));
    }
  };

  const filtered = items.filter(i => {
    const t = (q || '').toLowerCase();
    if (!t) return true;
    return [i.name, i.sku, i.category].some(x => (x || '').toLowerCase().includes(t));
  });

  return (
    <main className="max-w-5xl mx-auto p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">จัดการเมนู</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/recipes" className="underline">สูตรเมนู</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
        </div>
      </div>

      {err && <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>}

      {/* ฟอร์มเพิ่ม/แก้ไข */}
      <div className="mt-4 border rounded-2xl p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="font-semibold mb-2">{form.id ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label className="text-sm">ชื่อเมนู</label>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="เช่น อเมริกาโน่เย็น"
              value={form.name}
              onChange={e=>setForm(f=>({...f, name: e.target.value}))}
            />
          </div>
          <div>
            <label className="text-sm">ราคา (฿)</label>
            <input
              type="number" min={0} step={0.01}
              className="w-full border rounded-xl px-3 py-2"
              placeholder="เช่น 50"
              value={form.price}
              onChange={e=>setForm(f=>({...f, price: e.target.value}))}
            />
          </div>
          <div>
            <label className="text-sm">SKU</label>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="เช่น AMER-I"
              value={form.sku}
              onChange={e=>setForm(f=>({...f, sku: e.target.value}))}
            />
          </div>
          <div>
            <label className="text-sm">หมวดหมู่</label>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="เช่น กาแฟ / ชา / ขนม"
              value={form.category}
              onChange={e=>setForm(f=>({...f, category: e.target.value}))}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e=>setForm(f=>({...f, is_active: e.target.checked}))}
            />
            เปิดขาย
          </label>
          <div className="flex gap-2">
            {form.id && (
              <button
                className="px-3 py-2 rounded-xl border"
                onClick={()=>setForm({...emptyForm})}
              >
                ยกเลิกแก้ไข
              </button>
            )}
            <button
              className="px-4 py-2 rounded-xl bg-black text-white"
              onClick={onSubmit}
              disabled={loading}
            >
              {loading ? 'กำลังบันทึก…' : (form.id ? 'บันทึกการแก้ไข' : 'เพิ่มเมนู')}
            </button>
          </div>
        </div>
      </div>

      {/* ค้นหา */}
      <div className="mt-4 flex items-center gap-2">
        <input
          className="border rounded-xl px-3 py-2 w-full sm:w-80"
          placeholder="ค้นหา ชื่อ / SKU / หมวดหมู่"
          value={q}
          onChange={e=>setQ(e.target.value)}
        />
        <button className="px-3 py-2 rounded-xl border" onClick={load}>รีเฟรช</button>
      </div>

      {/* ตารางเมนู */}
      <div className="mt-3 border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-neutral-800">
            <tr className="text-left">
              <th className="py-2 px-3">ชื่อเมนู</th>
              <th className="py-2 px-3">ราคา</th>
              <th className="py-2 px-3">SKU</th>
              <th className="py-2 px-3">หมวดหมู่</th>
              <th className="py-2 px-3">สถานะ</th>
              <th className="py-2 px-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="py-3 px-3 text-gray-500" colSpan={6}>ไม่มีเมนู</td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="border-t">
                <td className="py-2 px-3">{p.name}</td>
                <td className="py-2 px-3">{Number(p.price||0).toFixed(2)} ฿</td>
                <td className="py-2 px-3">{p.sku}</td>
                <td className="py-2 px-3">{p.category}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                    {p.is_active ? 'ขายอยู่' : 'ปิดขาย'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button className="px-2 py-1 rounded border" onClick={()=>onEdit(p)}>แก้ไข</button>
                    <button className="px-2 py-1 rounded border" onClick={()=>onToggle(p)}>
                      {p.is_active ? 'ปิดขาย' : 'เปิดขาย'}
                    </button>
                    <button className="px-2 py-1 rounded border text-red-600" onClick={()=>onDelete(p)}>ลบ</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
