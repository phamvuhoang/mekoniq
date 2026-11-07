const c = require('./common.cjs');
const { randomUUID } = require('node:crypto');
(async () => {
  const manifest = [], browser = await c.launch();
  const labId = 'guide-' + randomUUID();
  try {
    const page = await browser.newPage({ viewport: { width:1440, height:960 }, deviceScaleFactor:1 });
    const screen = async route => {
      await page.goto('http://127.0.0.1:3452/' + route + '?actor=manager&lab=' + labId);
      await c.expect(page.getByRole('button',{name:'Làm mới',exact:true})).toBeVisible();
    };
    const shot = (id,title) => c.capture(page,manifest,{id,title,repo:'source',environment:'local-fixture',scope:'Tablet web 3452 backed by isolated fixture coordinator 3451, random X-Test-Lab; synthetic orders, no restaurant hardware or production records.'});
    await screen('pos');
    await page.locator('.menu-item',{hasText:'Cơm'}).click();
    await page.locator('.menu-item',{hasText:'Trà'}).click();
    await shot('source-pos','Tablet: gọi món tại quầy');
    await page.getByRole('button',{name:'Gửi bếp',exact:true}).click();
    await c.expect(page.locator('.toast')).toHaveText('Đã ghi nhận');
    await screen('kitchen');
    await c.expect(page.getByRole('button',{name:'Sẵn sàng',exact:true}).first()).toBeVisible();
    await shot('source-kitchen','Tablet: phiếu bếp');
    await screen('checkout');
    await page.getByRole('button',{name:'Mở ca thu ngân',exact:true}).click();
    await page.getByRole('button',{name:'Chuẩn bị hóa đơn',exact:true}).first().click();
    await c.expect(page.getByText(/Còn phải thu/).first()).toBeVisible();
    await shot('source-checkout','Tablet: chuẩn bị hóa đơn');
    for (const [route,title] of [['fleet','Tablet: điều phối đội robot'],['inventory','Tablet: kho và nguyên liệu'],['device','Tablet: thiết bị và đồng bộ']]) {
      await screen(route); await shot('source-' + route,title);
    }
  } finally { await browser.close(); c.saveManifest('tablet',manifest); }
})().catch(() => { console.error('Tablet capture failed; no failure screenshot was written.'); process.exitCode=1; });
