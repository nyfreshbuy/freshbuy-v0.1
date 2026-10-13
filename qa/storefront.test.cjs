const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium,webkit} = require('playwright');
const source = JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/catalog.json'),'utf8'));
const catalog = source.products;
const qaProduct = {...catalog[0],_id:'000000000000000000000001',id:'000000000000000000000001',name:'测试苹果',nameEn:'Test Apple',topCategoryKey:'fresh',category:'生鲜果蔬',subCategory:'水果',type:'normal',tag:'',price:4,originPrice:4,stock:2,allowZeroStock:false,variants:[],specialEnabled:false,isActive:true};
const products = [qaProduct,...catalog];
const order = {_id:'qa-order',id:'qa-order',orderNo:'QA-20261013',createdAt:'2026-10-13T12:00:00Z',status:'paid',paymentMethod:'cash',deliveryType:'home',addressText:'QA Test Address',items:[{name:'测试苹果',nameEn:'Test Apple',qty:1,price:4,lineTotal:4}],subtotal:4,deliveryFee:0,total:4};
async function configure(context,{native=false}={}) {
 await context.addInitScript(({native}) => {
  localStorage.setItem('freshbuy_token','qa-token');
  localStorage.setItem('freshbuy_user',JSON.stringify({name:'测试用户',phone:'0000000000'}));
  if(native) window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'ios',Plugins:{}};
 },{native});
 await context.route('http://127.0.0.1:4173/api/**',async route => {
  const req=route.request();const pathname=new URL(req.url()).pathname;
  let data={success:true,data:{},items:[]};
  if(pathname==='/api/products-simple') data={success:true,ok:true,items:products,list:products,products};
  else if(/\/orders\/my/.test(pathname)) data={success:true,orders:[order],total:1};
  else if(pathname==='/api/orders/qa-order') data={success:true,data:order};
  else if(/\/users\/me|\/auth\/me/.test(pathname)) data={success:true,user:{name:'测试用户',nickname:'测试用户',phone:'0000000000',walletBalance:10},data:{name:'测试用户',walletBalance:10}};
  else if(/\/addresses/.test(pathname)) data={success:true,addresses:[],data:[],defaultAddress:null};
  else if(/\/banners/.test(pathname)) data={success:true,data:[],banners:[]};
  else if(/\/orders|\/coupons|\/recharge/.test(pathname)) data={success:true,data:[],items:[]};
  // All test writes are intercepted; nothing can create a production order or change an account.
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
}
(async()=>{
 const results=[]; const browser=await chromium.launch({headless:true});
 const devices=[{width:320,height:740,cols:2},{width:390,height:844,cols:2},{width:768,height:1024,cols:3},{width:820,height:1180,cols:3},{width:1180,height:820,cols:4},{width:1280,height:900,cols:5},{width:1440,height:1000,cols:5},{width:1600,height:1000,cols:6}];
 const pages=['index.html','category.html?cat=fresh','Normal.html','DailySpecial.html','product_detail.html?id=000000000000000000000001','cart.html','user_center.html','orders.html','order_detail.html?id=qa-order','checkout.html'];
 for(const device of devices){
  const context=await browser.newContext({viewport:{width:device.width,height:device.height},serviceWorkers:'block'});await configure(context);
  for(const path of pages){
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4173/user/'+path);
   await page.waitForSelector('.fb-bottom-nav',{state:'attached'});
   if(['index','category','Normal'].some(p=>path.startsWith(p))) await page.waitForSelector('.product-card');
   if(path.startsWith('product_detail')) await page.waitForFunction(()=>document.querySelector('#detailTitle')?.textContent.includes('测试苹果'));
   if(path.startsWith('order_detail')) await page.waitForFunction(()=>document.querySelector('#orderDetailContainer')?.textContent.includes('QA-20261013'));
   const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,cols:[...document.querySelectorAll('.product-grid')].map(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),bottom:getComputedStyle(document.querySelector('.fb-bottom-nav')).display,sidebar:document.querySelector('.fb-category-sidebar')&&getComputedStyle(document.querySelector('.fb-category-sidebar')).display}));
   for (const box of await page.locator('.product-image-wrap').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height}}))) assert.ok(Math.abs(box.w-box.h)<2, `image ratio ${device.width} ${path}`);
   if(await page.locator('.fb-fixed-header').count()) { const position=await page.evaluate(()=>({header:document.querySelector('.top-nav').getBoundingClientRect().bottom,main:document.querySelector('.fb-catalog-content')?.getBoundingClientRect().top})); if(position.main) assert.ok(position.main>=position.header,`header covers content ${device.width} ${path}`); }
   assert.equal(metrics.scroll,metrics.width,`overflow ${device.width} ${path}`);
   for(const cols of metrics.cols) assert.equal(cols,device.cols,`columns ${device.width} ${path}`);
   assert.equal(metrics.bottom,device.width<1280?'grid':'none');
   assert.deepEqual(errors,[],`JS errors ${device.width} ${path}`);
   if(device.width===390 || device.width===1440) await page.screenshot({path:`qa/${path.split('?')[0].replace('.html','')}-${device.width}.png`,fullPage:false});
   results.push({device:device.width,page:path,pass:true});await page.close();
  }
  await context.close();
 }
 // Actual user actions: bilingual search, no-results/clear, details, stock limit, cart persistence and totals.
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await configure(context);
 const page=await context.newPage(); await page.goto('http://127.0.0.1:4173/user/index.html');await page.waitForSelector('.product-card');
 const search=page.locator('#globalSearchInput');await search.fill('Test Apple');await search.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#productGridNormal .product-name')?.textContent.includes('测试苹果'));
 assert.equal(await page.locator('#productGridNormal .product-card').count(),1);
 await search.fill('不存在的测试商品');await search.press('Enter');assert.match(await page.locator('#productGridNormal').textContent(),/没有找到/);
 await search.fill('');assert.ok(await page.locator('#productGridNormal .product-card').count()>0);
 await search.fill('测试苹果');await search.press('Enter');
 const card=page.locator('#productGridNormal .product-card');await card.locator('[data-add-only]').click();
 await page.waitForFunction(()=>window.FreshCart.getCount()===1);
 await card.locator('[data-qty-plus]').click();await page.waitForFunction(()=>window.FreshCart.getCount()===2);
 assert.equal(await card.locator('[data-qty-plus]').isDisabled(),true);
 await card.locator('[data-qty-minus]').click();await page.waitForFunction(()=>window.FreshCart.getCount()===1);
 assert.equal(await page.locator('.fb-bottom-nav .fb-nav-count').textContent(),'1');
 await page.locator('#cartIcon').click();await page.waitForFunction(()=>document.getElementById('cartDrawer').getBoundingClientRect().right <= innerWidth + 1);
 assert.ok(await page.locator('#cartDrawer').isVisible());await page.locator('#cartCloseBtn').click();
 await card.locator('.product-name').click();await page.waitForURL(/product_detail/);
 await page.waitForFunction(()=>document.querySelector('#detailTitle')?.textContent.includes('测试苹果'));
 assert.match(await page.locator('#detailTitle').textContent(),/Test Apple/);
 await page.locator('.fb-bottom-nav a[data-tab=cart]').click();await page.waitForURL(/cart.html/);
 await page.waitForSelector('#cartList .cart-item');assert.match(await page.locator('#cartList').textContent(),/测试苹果/);
 assert.equal(await page.evaluate(()=>window.Cart.getCount()),1);
 assert.match(await page.locator('#cartList').textContent(),/Test Apple/);
 await page.screenshot({path:'qa/cart-populated-390.png'});
 await page.reload();await page.waitForSelector('#cartList .cart-item');assert.equal(await page.evaluate(()=>window.Cart.getCount()),1);
 assert.equal(await page.evaluate(()=>window.Cart.getSubtotal()),4);
 await page.locator('#cartList [data-action=plus]').click().catch(async()=>{await page.locator('#cartList .qty-btn').last().click();});
 await page.waitForFunction(()=>window.Cart.getCount()===2);assert.equal(await page.evaluate(()=>window.Cart.getSubtotal()),8);
 page.once('dialog',d=>d.accept());await page.locator('#btnClear').click();await page.waitForFunction(()=>window.Cart.getCount()===0);
 await context.close();await browser.close();
 // Safari rendering and existing native iOS shell must not produce duplicate bottom bars.
 const safari=await webkit.launch({headless:true});
 for(const native of [false,true]){
  const context=await safari.newContext({viewport:{width:390,height:844},serviceWorkers:'block',isMobile:true,hasTouch:true});await configure(context,{native});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/user/index.html');await page.waitForSelector('.product-card');
  assert.deepEqual(errors,[]);assert.equal(await page.locator('.fb-bottom-nav').count(),1);assert.equal(await page.locator('.freshbuy-app-nav').count(),0);
  results.push({engine:'webkit',native,pass:true});await context.close();
 }
 await safari.close();fs.writeFileSync('qa/results.json',JSON.stringify(results,null,2));console.log('PASS: '+results.length+' layout/browser cases plus search, detail, inventory and cart actions');
})().catch(e=>{console.error(e);process.exit(1)});
