const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./test/browser',timeout:90000,workers:1,
  use:{baseURL:'http://127.0.0.1:18085',viewport:{width:1280,height:720},
    launchOptions:{...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']},
    screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'node scripts/start.js --demo',url:'http://127.0.0.1:18085',timeout:30000,reuseExistingServer:false,
    env:{PORT:'18085',STREAM_PORT:'18081',WS_PORT:'18082'}}
});
