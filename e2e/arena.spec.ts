import { readFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test,expect,type Page } from '@playwright/test';
import type { DemoData } from '../apps/web/lib/demo';

const demo=JSON.parse(readFileSync(resolve('apps/web/public/demo.json'),'utf8')) as DemoData;
const clean=demo.scenarios.find(s=>s.id==='clean')!;
const names=demo.competitors.map(c=>c.name);
const money=(cents:number)=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',maximumFractionDigits:2}).format(cents/100);

async function openArena(page:Page){
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Inspect TypeSafe Jev',exact:true})).toBeVisible();
  await expect(page.locator('[data-arena-state="ready"]')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.evaluate(()=>document.fonts.ready);
}
async function seek(page:Page,tick:number){
  const slider=page.getByRole('slider',{name:'Replay tick'});
  if(tick===0||tick===120){await slider.focus();await slider.press(tick===0?'Home':'End');}
  else await slider.evaluate((element,value)=>{
    const input=element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },tick);
  await expect(slider).toHaveValue(String(tick));
  await expect(page.locator('.time')).toHaveText(`${String(tick).padStart(3,'0')} / 120 ticks`);
}
async function noHorizontalClipping(page:Page){
  const widths=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth}));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport+1);
}

// Every test denies/records external requests; local replay controls must not call providers.
test.beforeEach(async({page,baseURL})=>{
  const origin=new URL(baseURL!).origin;
  const external:string[]=[];
  const writes:string[]=[];
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{
    const url=new URL(request.url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)external.push(request.url());
    if(request.method()!=='GET'&&request.method()!=='HEAD')writes.push(`${request.method()} ${request.url()}`);
  });
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['http:','https:'].includes(url.protocol)&&url.origin!==origin?route.abort('blockedbyclient'):route.continue();
  });
  (page as Page&{_arenaNetwork?:{external:string[];writes:string[];pageErrors:string[]}})._arenaNetwork={external,writes,pageErrors};
});
test.afterEach(async({page})=>{
  const network=(page as Page&{_arenaNetwork?:{external:string[];writes:string[];pageErrors:string[]}})._arenaNetwork!;
  expect(network.pageErrors,'The arena raised an uncaught browser error').toEqual([]);
  expect(network.external,'The offline arena attempted an external HTTP request').toEqual([]);
  expect(network.writes,'The offline arena attempted a write or provider request').toEqual([]);
});

test('shows three honest demo stalls and the rules baseline in analytical mode',async({page})=>{
  await openArena(page);
  await expect(page.getByText('OFFLINE DEMO',{exact:true})).toBeVisible();
  for(const name of names)await expect(page.getByRole('button',{name:`Inspect ${name}`,exact:true})).toBeVisible();
  await expect(page.locator('.stall-label')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Inspect TypeSafe Jev',exact:true})).toHaveAccessibleDescription(/Provisional profit SGD.*Rules demo mirror.*waiting/);
  await expect(page.locator('.footer')).toContainText('These are not model results');
  await page.getByRole('button',{name:'Analytical',exact:true}).click();
  await expect(page.getByRole('button',{name:'Analytical',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('row').filter({hasText:'Rules baseline'})).toBeVisible();
  await expect(page.getByRole('table')).toContainText('identical rules-demo mirrors');
  await noHorizontalClipping(page);
});

test('plays recorded ticks, seeks real outcomes and settles at the terminal boundary',async({page})=>{
  await openArena(page);await page.clock.install();
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.clock.runFor(1700);
  await expect(page.getByRole('slider',{name:'Replay tick'})).toHaveValue('2');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await seek(page,60);
  const recorded=clean.turns[60]!;
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(recorded.stalls[0].profitCents)} Provisional profit SGD`);
  await expect(page.locator('.stall-label .state').first()).toHaveText(`${recorded.stalls[0].queueCount} waiting · ${recorded.stalls[0].readyPortions} ready`);
  await seek(page,120);
  await expect(page.getByRole('button',{name:'Replay',exact:true})).toBeVisible();
  await expect(page.locator('.venue')).toContainText('Service complete');
  await expect(page.locator('.stall-label').first()).toContainText('Final profit');
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(clean.terminal.stalls[0].profitCents)} Final profit SGD`);
  await page.getByRole('button',{name:'Replay',exact:true}).click();
  await expect(page.getByRole('slider',{name:'Replay tick'})).toHaveValue('0');
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
});

test('resets to the selected recording without carrying another scenario decision',async({page})=>{
  await openArena(page);await seek(page,40);
  await page.getByRole('button',{name:'Inspect Zoom Decisions Pro',exact:true}).click();
  await expect(page.getByRole('region',{name:'Selected decision'})).toContainText('tick 40');
  await page.getByRole('combobox',{name:'Recorded scenario'}).selectOption('bus');
  await expect(page.getByRole('slider',{name:'Replay tick'})).toHaveValue('0');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Selected decision'})).toContainText('tick 0');
  await seek(page,120);
  const terminal=demo.scenarios.find(s=>s.id==='bus')!.terminal;
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(terminal.stalls[0].profitCents)} Final profit SGD`);
});

test('pins a selected decision while seeking and switching view modes',async({page})=>{
  await openArena(page);await seek(page,15);
  await page.getByRole('button',{name:'Inspect Zoom Decisions Pro',exact:true}).click();
  const compact=page.getByRole('region',{name:'Selected decision'});
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 15');
  const before=await compact.locator('p').textContent();
  await seek(page,65);await page.getByRole('button',{name:'Analytical',exact:true}).click();
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 15');
  await expect(compact.locator('p')).toHaveText(before!);
  await page.getByRole('button',{name:'Cinematic',exact:true}).click();
  await page.getByRole('button',{name:'Show analysis',exact:true}).click();
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 15');
  await compact.getByRole('button',{name:/Jump to latest/}).click();
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 65');
});

test('keeps dialog focus contained and restores it after Escape',async({page})=>{
  await openArena(page);await page.getByRole('button',{name:'Inspect TypeSafe Jev',exact:true}).click();
  const opener=page.getByRole('button',{name:'Expand decision',exact:true});await opener.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'TypeSafe Jev · decision 0',exact:true})).toBeVisible();
  for(let index=0;index<12;index++){
    await page.keyboard.press('Tab');
    // Native dialogs allow a Tab stop in browser chrome (document.body), while the app behind remains inert.
    expect(await page.evaluate(()=>document.activeElement===document.body||Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  }
  expect(await dialog.evaluate(element=>element.matches(':modal'))).toBe(true);
  await page.locator('.top-actions > button').evaluate(element=>(element as HTMLElement).focus());
  expect(await page.evaluate(()=>document.activeElement===document.body||Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(opener).toBeFocused();
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Your seat at the hawker centre'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Help',exact:true})).toBeFocused();
});

test('allows single-key shortcuts to be disabled and preserves that preference',async({page})=>{
  await openArena(page);await page.getByRole('button',{name:'Show analysis',exact:true}).click();
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await page.getByRole('checkbox',{name:'Enable single-key shortcuts'}).uncheck();
  await page.keyboard.press('Escape');await page.keyboard.press('3');
  await expect(page.getByRole('region',{name:'Selected decision'}).getByRole('heading')).toHaveText('TypeSafe Jev · tick 0');
  await page.reload();await expect(page.getByRole('button',{name:'Inspect TypeSafe Jev',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Enable single-key shortcuts'})).not.toBeChecked();
});

test('treats votes as local previews without changing replay state or results',async({page})=>{
  await openArena(page);await seek(page,60);
  const profits=await page.locator('.stall-label .profit').allTextContents();
  await page.getByRole('button',{name:'Vote preview',exact:true}).click();
  await page.getByRole('button',{name:/^Bus arrival Six extra customers/}).click();
  const rail=page.getByRole('complementary',{name:'Local vote preview'});
  await expect(rail).toContainText('Bus arrival selected locally. No vote sent.');
  await expect(rail).toContainText('Voting is unavailable in this rules replay');
  await expect(page.getByRole('slider',{name:'Replay tick'})).toHaveValue('60');
  expect(await page.locator('.stall-label .profit').allTextContents()).toEqual(profits);
  await expect(page.getByRole('combobox',{name:'Recorded scenario'})).toHaveValue('clean');
  await page.getByRole('button',{name:'Close vote preview'}).click();await expect(rail).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Vote preview',exact:true})).toBeFocused();
  await page.keyboard.press('v');await expect(rail).toBeVisible();
  await page.keyboard.press('Escape');await expect(rail).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Vote preview',exact:true})).toBeFocused();
});

test('restores analysis-toggle focus when a shortcut collapses the focused HUD',async({page})=>{
  await openArena(page);await page.getByRole('button',{name:'Show analysis',exact:true}).click();
  await page.getByRole('button',{name:'Expand decision',exact:true}).focus();
  await page.keyboard.press('h');await expect(page.getByRole('button',{name:'Show analysis',exact:true})).toBeFocused();
  await page.keyboard.press('h');await page.getByRole('button',{name:'Expand decision',exact:true}).focus();
  await page.keyboard.press('c');await expect(page.getByRole('button',{name:'Show analysis',exact:true})).toBeFocused();
});

test('renders a usable explicit load-error state',async({page})=>{
  await page.route('**/demo.json',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture unavailable"}'}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'The replay could not load.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reload demo'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('No provider request has been made');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('respects reduced motion while retaining playback controls',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openArena(page);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  const first=await page.locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(300);
  const second=await page.locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());
  expect(second).toBe(first);
  expect(await page.getByRole('button',{name:'Pause',exact:true}).evaluate(button=>getComputedStyle(button).transitionDuration)).toBe('0s');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
});

test('captures the default, crowded and dialog compositions without clipping',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openArena(page);
  const directory=resolve('results/p1-ui-review',testInfo.project.name);mkdirSync(directory,{recursive:true});
  await noHorizontalClipping(page);
  await page.screenshot({path:resolve(directory,'default.png'),fullPage:true,animations:'disabled'});
  await seek(page,45);await page.getByRole('button',{name:'Analytical',exact:true}).click();
  await page.getByRole('button',{name:'Vote preview',exact:true}).click();
  await noHorizontalClipping(page);
  for(const name of names)await expect(page.getByRole('button',{name:`Inspect ${name}`,exact:true})).toBeVisible();
  for(const button of await page.locator('.stall-label').all()){
    const bounds=await button.boundingBox();expect(bounds).not.toBeNull();
    expect(bounds!.width,'Stall summaries must retain a readable width at zoomed sizes').toBeGreaterThanOrEqual(120);
  }
  for(const button of await page.locator('.vote-choice').all()){
    const buttonBounds=await button.boundingBox();const descriptionBounds=await button.locator('span').boundingBox();
    expect(buttonBounds).not.toBeNull();expect(descriptionBounds).not.toBeNull();
    expect(descriptionBounds!.y+descriptionBounds!.height,'Vote description must fit inside its own button').toBeLessThanOrEqual(buttonBounds!.y+buttonBounds!.height+1);
  }
  const column=await page.getByRole('region',{name:'Three-stall offline arena'}).boundingBox();
  const rail=await page.getByRole('complementary',{name:'Local vote preview'}).boundingBox();
  expect(column).not.toBeNull();expect(column!.width,'The arena column must not collapse when voting is open').toBeGreaterThanOrEqual(Math.min(480,page.viewportSize()!.width-32));
  if(page.viewportSize()!.width>=1366){
    expect(column).not.toBeNull();expect(rail).not.toBeNull();expect(column!.x+column!.width).toBeLessThanOrEqual(rail!.x+1);
    const canvas=await page.locator('canvas').boundingBox();expect(canvas).not.toBeNull();
    expect(canvas!.width,'Crowded desktop art must retain at least 2× logical scale').toBeGreaterThanOrEqual(960);
    expect(Math.abs(canvas!.width/480-Math.round(canvas!.width/480))).toBeLessThan(0.01);
    expect(Math.abs(canvas!.height/240-canvas!.width/480)).toBeLessThan(0.01);
    const baseline=await page.getByRole('row').filter({hasText:'Rules baseline'}).boundingBox();
    const hud=await page.locator('.hud-body').boundingBox();expect(baseline).not.toBeNull();expect(hud).not.toBeNull();
    expect(baseline!.y+baseline!.height,'Rules baseline must remain within the desktop analysis panel').toBeLessThanOrEqual(Math.min(page.viewportSize()!.height,hud!.y+hud!.height)+1);
  }
  await page.screenshot({path:resolve(directory,'crowded.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Expand decision',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await noHorizontalClipping(page);
  await page.screenshot({path:resolve(directory,'dialog.png'),fullPage:true,animations:'disabled'});
});
