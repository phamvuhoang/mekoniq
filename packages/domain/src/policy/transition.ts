export function transitionFeature(enabled:boolean,openWork:number) {
  if(!Number.isSafeInteger(openWork)||openWork<0)throw new Error('INVALID_OPEN_WORK');
  return enabled?'enabled':openWork>0?'draining':'disabled';
}
