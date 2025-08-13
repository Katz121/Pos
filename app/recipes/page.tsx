'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
// ถ้าโปรเจกต์คุณไม่ได้ตั้ง alias "@", เปลี่ยน path นี้เป็นเส้นทางสัมพัทธ์ที่ถูกต้อง เช่น "../../lib/supabase/client"
import { createClient } from '@/app/lib/supabase/client';

/* ----- safeId: ใช้แทน crypto.randomUUID() เพื่อให้ทำงานบน iOS ได้ ----- */
function safeId(prefix = 'id') {
  try {
    const anyCrypto: any = globalThis.crypto;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
    if (anyCrypto?.getRandomValues) {
      const buf = new Uint8Array(16);
      anyCrypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40; // v4
      buf[8] = (buf[8] & 0x3f) | 0x80; // variant
      const hex = [...buf].map(b => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10,16).join('')}`;
    }
  } catch {}
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/* -------------------- Types -------------------- */
type Product = { id: string; name: string };
type Ingredient = { id: string; name: string; unit: string };

type RecipeLineUI = {
  tmpId: string;                 // key ฝั่ง UI
  recipe_id?: string | null;     // id ในตาราง recipes (มีถ้าโหลดจาก DB)
  ingredient_id: string;
  qty_per_unit: number;
  ingredient_name?: string;
  ingredient_unit?: string;
};

export default function RecipesPage() {
  // ทำ client ให้คงที่ตลอดอายุคอมโพเนนต์ (กัน loop)
  const supabase = useMemo(() => createClient(), []);

  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [lines, setLines] = useState<RecipeLineUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /* ---------- โหลดสินค้า + วัตถุดิบ (ครั้งเดียว) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const [{ data: prod, error: e1 }, { data: ing, error: e2 }] = await Promise.all([
          supabase.from('products').select('id,name').eq('is_active', true).order('name', { ascending: true }),
          supabase.from('ingredients').select('id,name,unit').eq('is_active', true).order('name', { ascending: true }),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        setProducts(prod || []);
        setIngredients(ing || []);
        if (!productId && prod && prod.length > 0) setProductId(prod[0].id);
      } catch (e: any) {
        setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    // อย่าใส่ supabase ใน deps (memoized แล้ว)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- ฟังก์ชันโหลดสูตรของสินค้าที่เลือก ---------- */
  const loadRecipe = useCallback(
    async (pid: string) => {
      if (!pid) { setLines([]); return; }
      try {
        setLoading(true);
        setErr(null);
        const { data, error } = await supabase
          .from('recipes')
          .select('id, ingredient_id, qty_per_unit, ingredients ( name, unit )')
          .eq('product_id', pid)
          .order('created_at', { ascending: true } as any);
        if (error) throw error;

        const mapped: RecipeLineUI[] = (data || []).map(r => ({
          tmpId: safeId('row'),
          recipe_id: r.id,
          ingredient_id: r.ingredient_id,
          qty_per_unit: Number(r.qty_per_unit),
          ingredient_name: (r as any).ingredients?.name ?? '',
          ingredient_unit: (r as any).ingredients?.unit ?? '',
        }));
        setLines(mapped);
      } catch (e: any) {
        setErr(e?.message || 'โหลดสูตรไม่สำเร็จ');
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  /* ---------- เมื่อ productId เปลี่ยน → โหลดสูตร ---------- */
  useEffect(() => {
    if (productId) loadRecipe(productId);
    else setLines([]);
  }, [productId, loadRecipe]);

  /* ---------- helper ---------- */
  const productName = useMemo(
    () => products.find(p => p.id === productId)?.name ?? '',
    [products, productId]
  );

  const addLine = () => {
    setLines(old => [...old, { tmpId: safeId('row'), ingredient_id: '', qty_per_unit: 0 }]);
  };

  const removeLine = (tmpId: string) => {
    setLines(old => old.filter(l => l.tmpId !== tmpId));
  };

  const updateLine = (tmpId: string, patch: Partial<RecipeLineUI>) => {
    setLines(old => old.map(l => (l.tmpId === tmpId ? { ...l, ...patch } : l)));
  };

  /* ---------- บันทึก (ลบของเดิมของสินค้านี้ แล้วใส่ใหม่ทั้งหมด) ---------- */
  const saveAll = async () => {
    try {
      if (!productId) return;

      const cleaned = lines
        .filter(l => l.ingredient_id && Number(l.qty_per_unit) > 0)
        .map(l => ({
          product_id: productId,
          ingredient_id: l.ingredient_id,
          qty_per_unit: Number(l.qty_per_unit),
        }));

      const { error: delErr } = await supabase.from('recipes').delete().eq('product_id', productId);
      if (delErr) throw delErr;

      if (cleaned.length > 0) {
        const { error: insErr } = await supabase.from('recipes').insert(cleaned);
        if (insErr) throw insErr;
      }

      alert('บันทึกสูตรเรียบร้อย');
      await loadRecipe(productId); // โหลดใหม่ให้ข้อมูลสด
    } catch (e: any) {
      alert('บันทึกไม่สำเร็จ: ' + (e?.message || 'ไม่ทราบสาเหตุ'));
      console.error(e);
    }
  };

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">สูตรเมนู (BOM)</h1>
        <div className="text-sm flex gap-3">
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/queue" className="underline">คิว</Link>
          <Link href="/stock" className="underline">สต๊อก</Link>
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">
          {err}
        </div>
      )}

      {/* เลือกเมนู */}
      <div className="mt-4 border rounded-2xl p-4 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="font-semibold mb-2">เลือกเมนู</div>
        <select
          className="w-full border rounded-xl px-3 py-2"
          value={productId}
          onChange={e => setProductId(e.target.value)}
        >
          <option value="">— เลือกเมนู —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* ฟอร์มสูตร */}
      {productId && (
        <div className="mt-4 border rounded-2xl p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              สูตรของเมนู: <span className="font-normal">{productName}</span>
            </div>
            <div className="text-xs text-gray-500">
              ระบุ “ปริมาณวัตถุดิบต่อ 1 แก้ว/เสิร์ฟ”
            </div>
          </div>

          {/* แถวสูตร */}
          <div className="mt-3 space-y-2">
            {lines.map(line => (
              <div key={line.tmpId} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-7">
                  <select
                    className="w-full border rounded-xl px-3 py-2"
                    value={line.ingredient_id}
                    onChange={e => {
                      const id = e.target.value;
                      const ing = ingredients.find(i => i.id === id);
                      updateLine(line.tmpId, {
                        ingredient_id: id,
                        ingredient_name: ing?.name,
                        ingredient_unit: ing?.unit
                      });
                    }}
                  >
                    <option value="">— เลือกวัตถุดิบ —</option>
                    {ingredients.map(i => (
                      <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-4">
                  <input
                    type="number"
                    min={0}
                    step={0.001}  // ✅ ใส่ค่าให้ step แล้ว
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder="ปริมาณต่อเสิร์ฟ"
                    value={line.qty_per_unit || ''}
                    onChange={e =>
                      updateLine(line.tmpId, { qty_per_unit: Number(e.target.value || 0) })
                    }
                  />
                </div>

                <div className="col-span-1 flex justify-end">
                  <button
                    className="text-xs px-2 py-1 rounded border text-red-600"
                    onClick={() => removeLine(line.tmpId)}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <button className="text-sm px-3 py-1 rounded border" onClick={addLine}>
                เพิ่มวัตถุดิบ
              </button>
              <button className="text-sm px-3 py-1 rounded bg-black text-white" onClick={saveAll}>
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {!productId && (
        <div className="mt-4 text-sm text-gray-600">
          เลือกเมนูด้านบนก่อน จากนั้นจึงเพิ่มวัตถุดิบและปริมาณต่อแก้ว
        </div>
      )}
    </main>
  );
}
