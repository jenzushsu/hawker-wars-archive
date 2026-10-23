import { defineConfig } from '@playwright/test';

const baseURL=process.env.PLAYWRIGHT_BASE_URL??'http://localhost:3000';
export default defineConfig({
  testDir:'./e2e', fullyParallel:false, workers:1, retries:0,
  timeout:45_000, expect:{timeout:10_000},
  reporter:[['list'],['html',{outputFolder:'results/p1-playwright-report',open:'never'}]],
  outputDir:'results/p1-playwright-artifacts',
  use:{baseURL,headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']},
  },
  projects:[
    {name:'reference',use:{viewport:{width:1920,height:1080}}},
    {name:'minimum',use:{viewport:{width:1366,height:768}}},
    {name:'reference-200-percent-equivalent',use:{viewport:{width:960,height:540},deviceScaleFactor:2}},
    {name:'minimum-200-percent-equivalent',use:{viewport:{width:683,height:384},deviceScaleFactor:2}},
  ],
  webServer:{command:'pnpm dev:web',url:baseURL,reuseExistingServer:!process.env.CI,timeout:120_000},
});
