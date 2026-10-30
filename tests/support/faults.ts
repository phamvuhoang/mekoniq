export class FaultSwitch {
  private armed=new Set<string>();
  arm(point:string){this.armed.add(point);}
  consume(point:string){const active=this.armed.has(point);this.armed.delete(point);return active;}
}
