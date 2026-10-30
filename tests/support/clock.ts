export class TestClock {
  constructor(public nowMs=Date.parse('2026-10-30T00:00:00Z')){}
  advance(ms:number){if(ms<0)throw new Error('NEGATIVE_TIME');this.nowMs+=ms;}
}
