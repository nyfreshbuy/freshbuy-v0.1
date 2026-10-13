const assert=require('node:assert/strict');const fs=require('node:fs');const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await c.route('http://127.0.0.1:4173/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  const data=p==='/api/products-simple'?JSON.parse(fs.readFileSync('qa/fixtures/catalog.json')):{success:true,data:{},items:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/user/index.html?auth=login');
 await p.waitForSelector('#authBackdrop.active');assert.equal(await p.locator('#authBackdrop').evaluate(e=>getComputedStyle(e).zIndex),'70000');
 await p.goto('http://127.0.0.1:4173/user/index.html?auth=register');await p.waitForSelector('#authBackdrop.active');
 assert.ok(await p.locator('#regPhone').isVisible());
 await p.goto('http://127.0.0.1:4173/user/category.html?cat=snacks&name='+encodeURIComponent('零食饮品'));await p.waitForSelector('.product-card');
 assert.ok(await p.locator('.fb-category-sidebar').isVisible());
 await p.locator('#searchInput').fill('Master Kong');await p.locator('#searchInput').press('Enter');
 assert.ok(await p.locator('.product-card').count()>0);assert.ok((await p.locator('.product-card .fb-name-en').allTextContents()).every(t=>t.includes('Master Kong')));
 await p.locator('#searchInput').fill('');await p.locator('#sortSelect').selectOption('priceAsc');
 assert.ok(await p.locator('.product-card').count()>0);
 await p.locator('.fb-category-sidebar a[href*=seasoning]').click();await p.waitForURL(/cat=seasoning/);await p.waitForSelector('.product-card');
 assert.match(await p.locator('#categoryTitle').textContent(),/调味酱料/);
 assert.deepEqual(errors,[]);await b.close();console.log('PASS: login/register modal routes, modal stacking, category navigation, English category search and sorting');
})().catch(e=>{console.error(e);process.exit(1)});
