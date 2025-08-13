'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/app/lib/supabase/client';

type OnhandRow = {
  ingredient_id: string;
  name: string;
  unit: string;
  min_level: number;
  base_per_purchase: number | null;
  onhand: number;
  onhand_in_packs: number | null;
};

export default function StockPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<OnhandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // เพิ่มวัตถุดิบ
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('g');      // g / ml / pcs
  const [newMin, setNewMin] = useState<number>(0);
  const [newPU, setNewPU] = useState('ถุง');        // purchase unit
  const [newBPP, setNewBPP] = useState<number>(1000); // base per purchase (เช่น 1000 g/ถุง)

  // เคลื่อนไหวสต๊อก
  const [selId, setSelId] = useState<string>('');
  const [type, setType] = useState<'in'|'waste'|'adjust'>('in');
  const [qtyBase, setQtyBase] = useState<number>(0);     // กรอกเป็นหน่วยฐาน (g)
  const [packCount, setPackCount] = useState<number>(0); // รับเข้าแบบแพ็ก: กี่แพ็ก
  const [packSize, setPackSize] = useState<number>(0);   // ขนาดต่อแพ็ก (g)
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('v_ingredient_onhand')
      .select('ingredient_id,name,unit,min_level,base_per_purchase,onhand,onhand_in_packs')
      .order('name', { ascending: true });
    if (error) { setErr(error.message); setLoading(false); return; }
    setRows((data || []) as OnhandRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // เมื่อเลือกวัตถุดิบ → ตั้ง packSize อัตโนมัติจาก base_per_purchase
  useEffect(() => {
    const ing = rows.find(r => r.ingredient_id === selId);
    setPackSize(ing?.base_per_purchase ? Number(ing.base_per_purchase) : 0);
  }, [selId, rows]);

  const lowCount = useMemo(
    () => rows.filter(i => Number(i.onhand) <= Number(i.min_level)).length,
    [rows]
  );

  const addIngredient = async () => {
    if (!newName.trim()) return;
    const payload: any = {
      name: newName.trim(),
      unit: newUnit.trim() || 'g',
      min_level: Number(newMin || 0),
    };
    if (newBPP && newBPP > 0) {
      payload.purchase_unit = newPU.trim() || null;
      payload.base_per_purchase = Number(newBPP);
    }
    await supabase.from('ingredients').insert([payload]);
    setNewName(''); setNewUnit('g'); setNewMin(0); setNewPU('ถุง'); setNewBPP(1000);
    await load();
  };

  const addMovement = async () => {
    if (!selId) return;

    let quantity = 0;

    if (type === 'in') {
      // โหมดรับเข้า: ถ้ากรอกจำนวนแพ็ก ให้คูณเป็นหน่วยฐาน
      if (packCount > 0 && packSize > 0) {
        quantity = packCount * packSize;
      } else {
        quantity = qtyBase; // รับเข้าเป็นหน่วยฐานตรงๆ
      }
    } else if (type === 'waste') {
      // ของเสีย: บังคับเป็นลบ
      quantity = -Math.abs(qtyBase);
    } else {
      // ปรับสต๊อก: ปล่อยให้ใส่ +/-
      quantity = qtyBase;
    }

    if (!quantity) return;

    await supabase.from('inventory_movements').insert([{
      ingredient_id: selId,
      qty: Number(quantity.toFixed(3)),      // เก็บเป็นหน่วยฐาน (เช่น g)
      move_type: type === 'in' ? 'in' : type === 'waste' ? 'waste' : 'adjust',
      reason: type,
      ref_id: null
    }]);

    // เคลียร์ฟอร์ม
    setQtyBase(0); setPackCount(0); setNote('');
    await load();
  };

  const deactivateIngredient = async (id: string) => {
  if (!confirm('ซ่อน/ปิดใช้งานวัตถุดิบนี้?')) return;
  const { error } = await supabase.from('ingredients').update({ is_active: false }).eq('id', id);
  if (error) { alert(error.message); return; }
  await load();
};

const hardDeleteIngredient = async (id: string, name: string) => {
  if (!confirm(`ลบ "${name}" ถาวร?\n(ลบไม่ได้ถ้ามีประวัติสต๊อกหรือถูกใช้ในสูตร)`)) return;
  const { error } = await supabase.from('ingredients').delete().eq('id', id);
  if (error) {
    // ส่วนมากจะเจอ foreign key constraint ถ้ามีการอ้างอิง
    alert('ลบไม่สำเร็จ: ' + (error.message || 'อาจมีการอ้างอิงอยู่ — แนะนำใช้ "ปิดใช้งาน"'));
    return;
  }
  await load();
};


  return (
    <main className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">วัตถุดิบ / สต๊อก</h1>
        <div className="text-sm flex gap-3">
          <Link href="/recipes" className="underline">สูตรเมนู</Link>
          <Link href="/pos" className="underline">POS</Link>
          <Link href="/reports" className="underline">รายงาน</Link>
        </div>
      </div>

      {err && <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-700">{err}</div>}

      {/* เพิ่มวัตถุดิบ */}
      <div className="mt-4 border rounded-2xl p-4">
        <div className="font-semibold mb-2">เพิ่มวัตถุดิบ</div>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
          <input className="border rounded-xl px-3 py-2" placeholder="ชื่อ (เช่น ผงกาแฟ)"
            value={newName} onChange={e=>setNewName(e.target.value)} />
          <input className="border rounded-xl px-3 py-2" placeholder="หน่วยฐาน (g/ml/pcs)"
            value={newUnit} onChange={e=>setNewUnit(e.target.value)} />
          <input type="number" className="border rounded-xl px-3 py-2" placeholder="min level"
            value={newMin || 0} onChange={e=>setNewMin(Number(e.target.value||0))} />
          <input className="border rounded-xl px-3 py-2" placeholder="หน่วยแพ็ก (เช่น ถุง)"
            value={newPU} onChange={e=>setNewPU(e.target.value)} />
          <input type="number" step="0.001" className="border rounded-xl px-3 py-2"
            placeholder="ขนาดต่อแพ็ก (กรัม)"
            value={newBPP || 0} onChange={e=>setNewBPP(Number(e.target.value||0))} />
          <button className="rounded-xl bg-black text-white px-4" onClick={addIngredient}>บันทึก</button>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          ตัวอย่าง: ผงกาแฟ — หน่วยฐาน <b>g</b>, หน่วยแพ็ก <b>ถุง</b>, ขนาดต่อแพ็ก <b>1000</b>
        </div>
      </div>

      {/* เคลื่อนไหวสต๊อก */}
      <div className="mt-4 border rounded-2xl p-4">
        <div className="font-semibold mb-2">รับเข้า / ของเสีย / ปรับสต๊อก</div>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
          <select className="border rounded-xl px-3 py-2" value={selId} onChange={e=>setSelId(e.target.value)}>
            <option value="">เลือกวัตถุดิบ…</option>
            {rows.map(i => <option key={i.ingredient_id} value={i.ingredient_id}>{i.name}</option>)}
          </select>

          <select className="border rounded-xl px-3 py-2" value={type} onChange={e=>setType(e.target.value as any)}>
            <option value="in">รับเข้า</option>
            <option value="waste">ของเสีย</option>
            <option value="adjust">ปรับ (+/-)</option>
          </select>

          {/* โหมดรับเข้าแบบแพ็ก (เฉพาะ type=in) */}
          {type === 'in' ? (
            <>
              <input type="number" step="1" className="border rounded-xl px-3 py-2"
                placeholder="จำนวนแพ็ก"
                value={packCount || ''} onChange={e=>setPackCount(Number(e.target.value||0))} />
              <input type="number" step="0.001" className="border rounded-xl px-3 py-2"
                placeholder="ขนาดต่อแพ็ก (หน่วยฐาน)"
                value={packSize || 0} onChange={e=>setPackSize(Number(e.target.value||0))} />
              <div className="self-center text-sm text-gray-600">
                ≈ {((packCount||0)*(packSize||0)).toFixed(3)}
              </div>
            </>
          ) : (
            <>
              <input type="number" step="0.001" className="border rounded-xl px-3 py-2 sm:col-span-2"
                placeholder={`จำนวน (${rows.find(r => r.ingredient_id===selId)?.unit || 'หน่วยฐาน'})`}
                value={qtyBase || ''} onChange={e=>setQtyBase(Number(e.target.value||0))} />
              <div className="sm:col-span-2 self-center text-sm text-gray-600">
                {type==='waste' ? 'จะหักออกเสมอ' : 'ใส่ + เพิ่ม / - ลด'}
              </div>
            </>
          )}

          <button className="rounded-xl border px-4" onClick={addMovement}>บันทึก</button>
        </div>
      </div>

      {/* ตารางคงเหลือ */}
      <div className="mt-6 border rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">คงเหลือ (Low stock: {lowCount})</div>
          <button className="px-3 py-1 rounded-xl border text-sm" onClick={load}>รีเฟรช</button>
        </div>
        {loading ? (
          <div className="mt-3">กำลังโหลด…</div>
        ) : (
          <div className="mt-3 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                <th className="py-1 pr-2">วัตถุดิบ</th>
                <th className="py-1 pr-2">หน่วยฐาน</th>
                <th className="py-1 pr-2 text-right">คงเหลือ (ฐาน)</th>
                <th className="py-1 pr-2 text-right">≈ แพ็ก</th>
                <th className="py-1 pr-2 text-right">ขั้นต่ำ</th>
                <th className="py-1 pr-2 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(i => (
                  <tr key={i.ingredient_id} className="border-t">
                    <td className="py-1 pr-2">{i.name}</td>
                    <td className="py-1 pr-2">{i.unit}</td>
                    <td className={`py-1 pr-2 text-right ${Number(i.onhand) <= Number(i.min_level) ? 'text-red-600 font-medium' : ''}`}>
                      {Number(i.onhand).toFixed(3)}
                    </td>
                    
                    <td className="py-1 pr-2 text-right">
                    <div className="flex justify-end gap-2">
                        <button className="text-xs px-2 py-1 rounded border"
                        onClick={() => deactivateIngredient(i.ingredient_id)}>ปิดใช้งาน</button>
                        <button className="text-xs px-2 py-1 rounded border text-red-600"
                        onClick={() => hardDeleteIngredient(i.ingredient_id, i.name)}>ลบ</button>
                    </div>
                    </td>
                    <td className="py-1 pr-2 text-right">{Number(i.min_level).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
