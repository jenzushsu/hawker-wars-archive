import { readRuntimeConfig, providerStatus } from './provider-config.js';
const config=readRuntimeConfig();
console.log(JSON.stringify({schemaVersion:'provider-activation-status-1',providers:['jev','zoom','zoom-pro'].map(p=>providerStatus(config,p as 'jev'|'zoom'|'zoom-pro')),networkCalls:0},null,2));
