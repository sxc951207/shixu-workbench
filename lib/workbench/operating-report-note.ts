// Exported reports may carry a prose footer in a merged cell beneath the store rows.
export function isOperatingReportNote(row:unknown[]){
 const cells=row.map(v=>String(v??'').trim()).filter(Boolean);
 const note=cells[0]||'';
 if(!/^(?:(?:统计口径|数据口径|口径说明|统计说明|数据说明|备注|说明)\s*[:：]|(?:好评率|有效好评率|退单率|核销率|核销ROI|下单ROI)\s*[=＝]|推广消耗缺失按\s*0\s*[。；;])/i.test(note))return false;
 if(cells.length>1)throw Error('统计说明行还有其他内容，请将说明与门店数值分行后再导入。');
 return true;
}
