'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import Link from 'next/link';

type Shift = {
  id: string; opened_at: string; opening_cash: number;
  closed_at: string | null; closing_cash: number | null; cash_diff: number | null;
};
type CashMove = { amount: number; txn_type: 'sale_cash'|'cash_in'|'cash_out'|'refund_cash'|'expense' };

const setLocalShift = (id: string | null) => {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem('siwara_shift_id', id);
  else localStorage.removeItem('siwara_shift_id');
};

export default function ShiftPage() {
  const supabase = createClient();
  const [current, setCurrent] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [openCash, setOpenCash] = useState<number>(0);
  const [note, setNote] = useState('');
  const [closingCash, setClosingCash] = useState<number>(0);
  const [moves, setMoves] = useState<CashMove[]>([]);
  const [amount, setAmount] = useState<number>(0);
  const [mvNote, setMvNote] = useState('');
  const [mvType, setMvType] = useState<CashMove['txn_type']>('cash_in');

  const load = async () => {
    setLoading(true);
    const { data: s } = await supabase.from('shifts')
      .select('id, opened_at, opening_cash, closed_at, closing_cash, cash_diff')
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1);
    const shift = (s && s.length > 0 ? s[0] : null) as Shift | null;
    setCurrent(shift);
    if (shift) {
      setLocalShift(shift.id);
      const { data: m } = await supabase.from('cash_movements')
        .select('amount, txn_type')
        .eq('shift_id', shift.id)
        .order('created_at', { ascending: true });
      setMoves((m || []) as CashMove[]);
    } else {
      setLocalShift(null);
      setMoves([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const expected = useMemo(() => {
    if (!current) return 0;
    const sumIn = moves.filter(m => m.txn_type === 'sale_cash' || m.txn_type === 'cash_in')
      .reduce((s, m) => s + Number(m.amount), 0);
    const sumOut = moves.filter(m => m.txn_type === 'cash_out' || m.txn_type === 'refund_cash' || m.txn_type === 'expense')
      .reduce((s, m) => s + Number(m.amount), 0);
    return Number(current.opening_cash) + sumIn - sumOut;
  }, [moves, current]);

  const openShift = async () => {
    const { data, error } = await supabase.from('shifts')
      .insert([{ opening_cash: Number(openCash.toFixed(2)), note }])
      .select('id, opened_at, opening_cash, closed_at, closing_cash, cash_diff')
      .single();
    if (error) { alert(error.message); return; }
    setLocalShift(data.id);
    setOpenCash(0); setNote('');
    await load();
  };

  const addMove = async () => {
    if (!current) return;
    if (!amount) return;
    const amt = Number(amount.toFixed(2));
    await supabase.from('cash_movements').insert([{
      shift_id: current.id,
      amount: mvType === 'cash_out' || mvType === 'refund_cash' || mvType === 'expense' ? -Math.abs(amt) : Math.abs(amt),
      txn_type: mvType,
      note: mvNote || null
    }]);
    setAmount(0); setMvNote('');
    await load();
  };

  const closeShift = async () => {
    if (!current) return;
    const closeAmt = Number(closingCash.toFixed(2));
    const diff = Number((closeAmt - expected).toFixed(2));
    const { error } = await supabase.from('shifts')
      .update({ closed_at: new Date().toISOString(), closing_cash: closeAmt, cash_diff: diff })
      .eq('id', current.id);
    if (error) { alert(error.message); return; }
    setLocalShift(null);
    setClosingCash(0);
    await load();
    alert(`ปิดกะแล้ว\nคาดว่าในลิ้นชัก: ${expected.toFixed(2)}\nนับจริง: ${closeAmt.toFixed(2)}\nขาด/เกิน: ${diff.toFixed(2)}`);
  };

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">กะการขาย</h1>

      {loading && <div>กำลังโหลด…</div>}

      {!loading && !current && (
        <div className="border rounded-2xl p-4">
          <div className="font-semibold mb-3">เปิดกะใหม่</div>
          <label className="text-sm">เงินสดตั้งต้น</label>
          <input type="number" step="0.01" className="w-full border rounded-xl px-3 py-2 mt-1"
            value={openCash} onChange={(e) => setOpenCash(Number(e.target.value))} />
          <label className="text-sm mt-3 block">หมายเหตุ</label>
          <input className="w-full border rounded-xl px-3 py-2 mt-1"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="mt-3 px-4 py-2 rounded-xl bg-black text-white" onClick={openShift}>เปิดกะ</button>
        </div>
      )}

      {!loading && current && (
        <div className="space-y-6">
          <div className="border rounded-2xl p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">กะปัจจุบัน</div>
                <div className="text-sm text-gray-600">เปิด: {new Date(current.opened_at).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div>ตั้งต้น: {Number(current.opening_cash).toFixed(2)}</div>
                <div className="font-semibold">คาดว่ามีเงินสด: {expected.toFixed(2)} ฿</div>
              </div>
            </div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="font-semibold mb-2">เงินสดเข้า/ออก</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {(['cash_in','cash_out','expense','refund_cash'] as const).map(t => (
                <button key={t}
                  className={`border rounded-xl py-2 ${mvType===t?'bg-black text-white':''}`}
                  onClick={() => setMvType(t)}>
                  {t==='cash_in'?'เงินเข้า':t==='cash_out'?'เงินออก':t==='expense'?'ค่าใช้จ่าย':'คืนเงินสด'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" className="border rounded-xl px-3 py-2"
                placeholder="จำนวนเงิน" value={amount || ''} onChange={(e)=>setAmount(Number(e.target.value||0))} />
              <input className="border rounded-xl px-3 py-2" placeholder="หมายเหตุ (เช่น ซื้อของจิปาถะ)"
                value={mvNote} onChange={(e)=>setMvNote(e.target.value)} />
            </div>
            <button className="mt-2 px-4 py-2 rounded-xl border" onClick={addMove}>บันทึก</button>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="font-semibold mb-2">ปิดกะ</div>
            <label className="text-sm">นับเงินสดปลายกะ</label>
            <input type="number" step="0.01" className="w-full border rounded-xl px-3 py-2 mt-1"
              value={closingCash || ''} onChange={(e) => setClosingCash(Number(e.target.value||0))} />
            <div className="text-sm mt-1">คาดว่า {expected.toFixed(2)} ฿</div>
            <button className="mt-3 px-4 py-2 rounded-xl bg-black text-white" onClick={closeShift}>ปิดกะ</button>
          </div>
        </div>
      )}

        <div className="mt-6">
        <Link href="/" className="underline">กลับหน้าแรก</Link>
        </div>
    </main>
  );
}
