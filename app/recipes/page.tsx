'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Product = { id: string; name: string };
type Ingredient = { id: string; name: string; unit: string };
type RecipeRow = { id: string; ingredient_id: string; qty_per_unit: number; ingredients: { name: string; unit: string } | null };

export default function RecipesPage() {
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selProd, setSelProd] = useState<string>('');
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadBase = async () => {
    const [{ data: p }, { data: i }] = await Promise.all([
      supabase.from('products').select('id,name').eq('is_active', true).order('name'),
      supabase.from('ingredients').select('id,name,unit').eq('is_active', true).order('name')
    ]);
    setProducts((p || []) as Product[]);
    setIngredients((i || []) as Ingredient[]);
  };

  const loadRecipe = async (pid: string) => {
    if (!pid) { setRows([]); return; }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('recipes')
      .select('id, ingredient_id, qty_per_unit, ingredients(name, unit)')
      .eq('product_id', pid)
      .order('id', { ascending: true });
    if (error) setErr(error.message);
    setRows((data || []) as RecipeRow[]);
    setLoading(false);
  };

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { loadRecipe(selProd); }, [selProd]);

  const addLine = () => setRows((old) => [...old, { id: 'new_' + crypto.randomUUID(), ingredient_id: '', qty_per_unit: 0, ingredients: null }]);
  const removeLine = (id: string) => setRows((old)=> old.filter(r => r.id !== id));
  const updateLine = (id: string, patch: Partial<RecipeRow>) =>
    setRows((old)=> old.map(r => r.id === id ? { ...r, ...patch } : r));

  const saveAll = async () => {
    if (!selProd) return;
    // ลบของเดิม แล้ว insert ใหม่ทั้งหมด (ง่ายและชัวร์)
    const toInsert = rows
      .filter(r => r.ingredient_id && r.qty_per_unit > 0)
      .map(r => ({ product_id: selProd, ingredient_id: r.ingredient_id, qty_per_unit: Number(r.qty_per_unit) }));
    const tx1 = await supabase.from('recipes').delete().eq('product_id', selProd);
    if (tx1.error) { alert(tx1.error.message); return; }
    if (toInsert.length > 0) {
      const tx2 = await supabase.from('recipes').insert(toInsert);
      if (tx2.error) { alert(tx2.error.message); return; }
    }
    await loadRecipe(selProd);
    alert('บันทึกสูตรเรียบร้อย');
  };

  return (
    <main className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">สูตรเมนู (BOM)</h1>
        <div className="text-sm flex gap-3">
          <Link href="/stock" className="underline">วัตถุดิบ</Link>
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
        </div>
      </div>

      <div className="mt-4 border rounded-2xl p-4">
        <label className="text-sm">เลือกสินค้า</label>
        <select className="mt-1 border rounded-xl px-3 py-2 w-full sm:w-96"
          value={selProd} onChange={(e)=>setSelProd(e.target.value)}>
          <option value="">— เลือกเมนู —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selProd && (
        <div className="mt-4 border rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">สูตรของเมนูที่เลือก</div>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-xl border" onClick={addLine}>เพิ่มวัตถุดิบ</button>
              <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={saveAll}>บันทึก</button>
            </div>
          </div>

          {loading ? <div className="mt-3">กำลังโหลด…</div> : (
            <div className="mt-3 space-y-2">
              {rows.length === 0 && <div className="text-gray-500 text-sm">ยังไม่มีสูตร — กด “เพิ่มวัตถุดิบ”</div>}
              {rows.map(r => (
                <div key={r.id} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center border rounded-xl px-3 py-2">
                  <select
                    className="border rounded-xl px-3 py-2 sm:col-span-3"
                    value={r.ingredient_id}
                    onChange={e => updateLine(r.id, { ingredient_id: e.target.value })}
                  >
                    <option value="">เลือกวัตถุดิบ…</option>
                    {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input
                    type="number" step="0.001"
                    className="border rounded-xl px-3 py-2 sm:col-span-2"
                    placeholder="ปริมาณต่อ 1 แก้ว/ชิ้น"
                    value={r.qty_per_unit || 0}
                    onChange={e => updateLine(r.id, { qty_per_unit: Number(e.target.value||0) })}
                  />
                  <button className="text-red-600 text-sm" onClick={()=>removeLine(r.id)}>ลบ</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
