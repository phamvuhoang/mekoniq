import {test,expect} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
test('scheduled missing cup holds the real pinned mock workflow and offers explicit reconcile',async({page})=>{
 test.skip(!token,'Requires test-mock-e2e launcher and current source pin');test.setTimeout(180000);
 await page.goto('/#twin');await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Ghép nối runtime'}).click();await openScenarioPicker(page);await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
 await openInspector(page,'setup');await page.getByTestId('fault-schedule').locator('summary').click();await page.locator('#twin-schedule-fault').selectOption('cup-removed');await expect(page.getByTestId('fault-schedule')).toHaveAttribute('open','');await page.locator('#twin-schedule-trigger').selectOption('phase');await expect(page.locator('#twin-schedule-value')).toBeVisible();await page.locator('#twin-schedule-value').selectOption('grasp');await page.getByRole('button',{name:'Thêm lỗi',exact:true}).click();
 await expect(page.getByTestId('fault-schedule').locator('li')).toContainText('cup-removed');await page.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();await expect(page.getByRole('button',{name:'Chạy mock',exact:true})).toBeVisible({timeout:10000});await page.getByRole('button',{name:'Chạy mock',exact:true}).click();await page.getByRole('button',{name:'Tự chạy',exact:true}).click();
 await expect(page.getByTestId('run-status')).toContainText('Cần kiểm tra',{timeout:120000});await expect(page.getByTestId('run-served')).toContainText('0');
 await expect(page.getByTestId('primary-action')).toHaveText('Đối soát');await page.getByTestId('primary-action').click();await page.getByRole('dialog').getByRole('button',{name:'Xác nhận đã kiểm tra'}).click();await expect(page.getByTestId('run-status')).toContainText('Cần kiểm tra');
 if(process.env.LAB_EVIDENCE_DIR)await page.screenshot({path:`${process.env.LAB_EVIDENCE_DIR}/V06-scheduled-cup-mock.png`,fullPage:true});
});
