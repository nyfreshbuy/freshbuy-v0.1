const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
(async()=>{
 let cases=0;
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1180,height:820},{width:1440,height:1000}]) {
   const context=await browser.newContext({viewport,serviceWorkers:'block'});
   await context.route('http://127.0.0.1:4173/api/**',route=>route.fulfill({contentType:'application/json',body:route.request().url().includes('products-simple')?fs.readFileSync('qa/fixtures/catalog.json','utf8'):JSON.stringify({success:true,data:{},items:[]})}));
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4173/user/index.html');await page.waitForSelector('.product-card');
   assert.equal(await page.locator('.fb-current-section').isVisible(),false);
   for(const id of ['sectionDailySpecial','sectionNew','sectionBest','sectionNormal','sectionDailySpecial']) {
    await page.evaluate(id=>{const sec=document.getElementById(id);const header=document.querySelector('.top-nav').getBoundingClientRect().height;const root=document.body.scrollHeight>document.body.clientHeight?document.body:document.scrollingElement;root.scrollTop+=sec.getBoundingClientRect().top-header+120;},id);
    const expected=await page.locator('#'+id+' .section-title').textContent();
    await page.waitForFunction(expected=>{const bar=document.querySelector('.fb-current-section');return !bar.hidden && bar.textContent===expected;},expected);
    const geometry=await page.evaluate(()=>({bar:document.querySelector('.fb-current-section').getBoundingClientRect().toJSON(),header:document.querySelector('.top-nav').getBoundingClientRect().toJSON(),width:innerWidth}));
    assert.ok(Math.abs(geometry.bar.top-geometry.header.bottom)<2);
    assert.ok(geometry.bar.left>=0&&geometry.bar.right<=geometry.width+1);
    if(id==='sectionNew') await page.screenshot({path:`qa/sticky-${engine.name()}-${viewport.width}.png`});
    cases++;
   }
   await page.evaluate(()=>{document.body.scrollTop=0;document.scrollingElement.scrollTop=0;});await page.waitForFunction(()=>document.querySelector('.fb-current-section').hidden);
   await page.locator('#globalSearchInput').fill('宝发');await page.locator('#globalSearchInput').press('Enter');
   await page.waitForFunction(()=>document.querySelector('#productGridNormal .product-card'));
   assert.deepEqual(errors,[]);await context.close();
  }
  await browser.close();
 }
 console.log(`PASS: ${cases} sticky-title scroll/switch cases across phones, iPad and desktop in Chromium and WebKit, plus return-to-top and search`);
})().catch(e=>{console.error(e);process.exit(1)});
