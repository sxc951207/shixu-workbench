'use client';
import {useCallback, useEffect, useRef} from 'react';
import {driver, type Driver, type DriveStep} from 'driver.js';
import 'driver.js/dist/driver.css';
import '../app/employee-tour.css';

const descriptions = {
  operating: '填经营数字或上传原表，从这里选项目和业务日期。',
  reports: '写当天做了什么、遇到什么问题，在这里填写项目日报，查看确认人并提交。',
  help: '忘了怎么操作？这里能重看按钮指引，也能查到详细的填报步骤。'
};
const seenInSession = new Set<string>();

export default function EmployeeTour({scope, replay = false}: {scope: string; replay?: boolean}) {
  const active = useRef<Driver | null>(null);
  const key = 'shixu-employee-tour-v1:' + scope;

  const start = useCallback(() => {
    if (active.current?.isActive()) return;
    const steps: DriveStep[] = [];
    for (const [id, description] of Object.entries(descriptions)) {
      const target = document.querySelector<HTMLElement>('[data-employee-guide="' + id + '"]');
      if (!target?.getClientRects().length || target.matches(':disabled')) continue;
      steps.push({element: target, popover: {title: target.innerText.trim(), description}});
    }
    if (!steps.length) return;
    const tour = driver({
      steps, animate: false, smoothScroll: false, scrollIntoView: {block:'nearest', inline:'center'},
      overlayOpacity: 0.48, stageRadius: 9, stagePadding: 4, disableActiveInteraction: true,
      showProgress: true, progressText: '{{current}} / {{total}}', nextBtnText: '下一步',
      prevBtnText: '上一步', doneBtnText: '知道了', closeBtnLabel: '跳过指引',
      popoverClass: 'sx-employee-popover',
      onPopoverRender: ({closeButton}) => {closeButton.textContent = '跳过';},
      onDestroyed: (_element, _step, {reason}) => {
        active.current = null;
        if (reason === 'api' || reason === 'replaced') return;
        seenInSession.add(key);
        try { localStorage.setItem(key, '1'); } catch { /* Session memory still applies. */ }
      }
    });
    active.current = tour;
    tour.drive();
  }, [key]);

  useEffect(() => {
    let seen = seenInSession.has(key);
    try { seen ||= localStorage.getItem(key) === '1'; } catch { /* Private browsing. */ }
    const frame = !replay && !seen ? requestAnimationFrame(start) : undefined;
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      active.current?.destroy();
    };
  }, [key, replay, start]);

  return replay ? <button type="button" className="co-text" onClick={start}>重看按钮指引</button> : null;
}
