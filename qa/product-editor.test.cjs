const assert=require('node:assert/strict');const {chromium,webkit}=require('playwright');
const sample={_id:'000000000000000000000001',id:'qa-product',name:'测试商品',price:12,originPrice:12,stock:100,status:'on',variants:[]};
async function setup(browser,width,baseline=false){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>{localStorage.setItem('admin_token','qa-test-token');});
 const writes=[];
 await context.route('**/api/**',async route=>{
  const req=route.request();if(req.method()!=='GET') writes.push({method:req.method(),url:req.url(),body:req.postDataJSON()});
  const path=new URL(req.url()).pathname;
  let data={success:true,list:[],batches:[]};
  if(path==='/api/auth/me')data={success:true,user:{role:'admin',name:'QA Admin'}};
  if(path==='/api/admin/products')data={success:true,list:[sample]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 if(baseline) await context.route('**/product-editor.css*',r=>r.fulfill({contentType:'text/css',body:''}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173/admin/products.html');
 await page.locator('#productTableBody').getByRole('button',{name:'编辑',exact:true}).click();
 await page.locator('#p_name').waitFor({state:'visible'});
 return {context,page,errors,writes};
}
(async()=>{
 const browser=await chromium.launch();
 const old=await setup(browser,390,true);
 console.log('Before phone field:',await old.page.locator('#p_originPrice').evaluate(e=>({input:e.getBoundingClientRect().height,field:e.parentElement.getBoundingClientRect().height})));
 await old.context.close();
 for(const width of [320,390,768,820,1440]){
  const {context,page,errors,writes}=await setup(browser,width);
  assert.equal(await page.locator('#p_name').inputValue(),'测试商品');
  const sizes=await page.locator('#editorTabBasic .form-row input:not([type=checkbox]), #editorTabBasic .form-row select').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).map(e=>({id:e.id,h:e.getBoundingClientRect().height})));
  assert.ok(sizes.every(e=>e.h<=44.5),JSON.stringify({width,sizes}));
  const nameBox=await page.locator('#p_name').boundingBox();assert.ok(nameBox.x>=0&&nameBox.x+nameBox.width<=width);
  if(width===390||width===1440)await page.evaluate(()=>document.getElementById('productEditorPanel').scrollIntoView({block:'start'}));
  if(width===390||width===1440)await page.screenshot({path:`qa/admin-product-compact-${width}.png`});
  await page.locator('#tabBtnPurchase').click();await page.locator('#pb_boxPrice').fill('100');await page.locator('#pb_boxCount').fill('3');await page.locator('#pb_unitsPerBox').fill('10');await page.locator('#pb_grossMarginPercent').fill('40');
  assert.equal(await page.locator('#pb_unitCost').inputValue(),'10.0000');assert.equal(await page.locator('#pb_totalUnits').inputValue(),'30');assert.equal(await page.locator('#pb_totalCost').inputValue(),'300.00');
  const purchaseSize=await page.locator('#pb_boxPrice').boundingBox();assert.ok(purchaseSize.height<=44.5);
  if(width===390||width===1440)await page.evaluate(()=>document.getElementById('productEditorPanel').scrollIntoView({block:'start'}));
  if(width===390||width===1440)await page.screenshot({path:`qa/admin-cost-compact-${width}.png`});
  await page.locator('#btnResetPurchaseForm').click();assert.equal(await page.locator('#pb_boxPrice').inputValue(),'');
  await page.locator('#tabBtnBasic').click();assert.equal(await page.locator('#p_name').inputValue(),'测试商品');
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS',width,'basic/purchase dimensions, tabs, cost calculations, reset; zero backend writes');await context.close();
 }
 await browser.close();const safari=await webkit.launch();const {context,page,errors}=await setup(safari,390);assert.equal(await page.locator('#p_originPrice').evaluate(e=>Math.round(e.getBoundingClientRect().height)),44);assert.deepEqual(errors,[]);await context.close();await safari.close();console.log('PASS WebKit mobile compact layout');
})().catch(e=>{console.error(e);process.exit(1)});
