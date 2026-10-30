import {test,expect} from '@playwright/test';

test('venue receipt does not claim a cloud commit and pending journal prevents reset',async({page})=>{
 await page.goto('/device');
 await expect(page.getByText('Nhà hàng đã nhận',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Đã đồng bộ cloud',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Xóa dữ liệu',exact:true})).toBeDisabled();
});
test('local commit is presented separately from venue or cloud acknowledgement',async({page})=>{
 await page.goto('/device?fixture=local-only');
 await expect(page.getByText('Đã lưu trên thiết bị',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Đã đồng bộ cloud',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Xóa dữ liệu',exact:true})).toBeDisabled();
});
test('chef route guards and language work on a portrait tablet',async({page})=>{
 await page.setViewportSize({width:800,height:1280});
 await page.goto('/checkout?actor=chef');
 await expect(page.getByRole('heading',{name:'Không có quyền truy cập'})).toBeVisible();
 await page.getByRole('button',{name:'Switch to English'}).click();
 await expect(page.getByRole('heading',{name:'Access denied'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
