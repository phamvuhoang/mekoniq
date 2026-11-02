import {test,expect} from '@playwright/test';
// Read-only: the shared fixture coordinator is used by later specs (shift/payment counts), so this spec mutates nothing.
test('cash shift and print queue screens render from real snapshots, with the fixture printer labelled as not physical',async({page})=>{
 await page.goto('/cash');
 await expect(page.getByRole('heading',{name:'Ca và sổ két',level:1})).toBeVisible();
 await expect(page.getByRole('button',{name:'Mở ca thu ngân',exact:true})).toBeVisible();
 await page.goto('/print');
 await expect(page.getByRole('heading',{name:'Hàng đợi in',level:1})).toBeVisible();
 await expect(page.getByText('FIXTURE spool printer')).toBeVisible();
 await expect(page.getByText('chưa chứng minh in thật trên giấy')).toBeVisible();
 await expect(page.locator('.badge').filter({hasText:'Sẵn sàng'})).toBeVisible();
});
