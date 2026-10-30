import {expect,test} from 'vitest';
import {businessDateAt} from '../../packages/domain/src/shared/clock';
test('business date uses venue zone while wire timestamps remain UTC',()=>{
 expect(businessDateAt('2026-10-30T18:30:00Z','Asia/Ho_Chi_Minh')).toBe('2026-10-31');
 expect(businessDateAt('2026-10-30T18:30:00Z','America/New_York')).toBe('2026-10-30');
 expect(()=>businessDateAt('2026-10-30T18:30:00Z','Invalid/Venue')).toThrow();
});
