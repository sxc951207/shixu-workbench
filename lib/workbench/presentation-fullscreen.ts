export function createPresentationFullscreen(host:Pick<Document,'fullscreenElement'|'exitFullscreen'>,target:HTMLElement){
 let owned=false,disposed=false,pending:Promise<boolean>|null=null;
 const exit=async()=>{if(owned&&host.fullscreenElement===target){await host.exitFullscreen();owned=false;}};
 return {
  get owns(){return owned&&host.fullscreenElement===target;},
  sync(){if(host.fullscreenElement!==target)owned=false;},
  enter():Promise<boolean>{
   if(disposed)return Promise.resolve(false);
   if(host.fullscreenElement)return Promise.resolve(owned&&host.fullscreenElement===target);
   if(pending)return pending;
   if(!target.requestFullscreen)return Promise.reject(Error('当前浏览器不支持全屏，可继续使用窗口演示'));
   // Call before any await so browser user activation is preserved.
   pending=target.requestFullscreen().then(async()=>{
    if(host.fullscreenElement!==target)return false;
    owned=true;if(disposed){await exit();return false;}return true;
   }).finally(()=>{pending=null;});
   return pending;
  },
  exit,
  dispose(){disposed=true;void exit().catch(()=>{});}
 };
}
