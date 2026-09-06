const {test,expect}=require('@playwright/test');
const query='?stream=ws://127.0.0.1:18082/';
test('live video and telemetry render with offline globe; camera controls work',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue():route.abort());
  await page.goto('/'+query);
  await expect(page.locator('#telemetry')).toContainText('DEMO-UAV');
  await expect(page.locator('#status')).toHaveText('Receiving telemetry');
  await expect(page.locator('#video-canvas')).toHaveAttribute('width','640');
  const frame = await page.evaluate(()=>UAV.player.video.currentFrame);
  await expect.poll(()=>page.evaluate(()=>UAV.player.video.currentFrame)).toBeGreaterThan(frame+5);
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.selectOption('#camera-mode','follow');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(()=>!!UAV.aircraft.position.getValue(UAV.viewer.clock.currentTime))).toBe(true);
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.screenshot({path:'test-results/follow.png'});
  await page.selectOption('#camera-mode','fpv');
  await page.waitForTimeout(1200);
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  await page.selectOption('#camera-mode','free');
  await page.check('#grid');
  await page.uncheck('#show-video');await expect(page.locator('#video-canvas')).toBeHidden();
  await page.check('#show-video');await page.check('#centre-video');await expect(page.locator('#video-canvas')).toHaveClass('centre');
  await page.uncheck('#centre-video');
  // Missing/invalid optional fields must not break telemetry handling.
  await page.evaluate(()=>document.getElementById('klv-output').dispatchEvent(new CustomEvent('klv',{detail:{payload:{}}})));
  await expect(page.locator('#telemetry')).toContainText('Latitude: —');
  await expect(page.locator('#telemetry')).toContainText('DEMO-UAV');
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/viewer.png'});
});
test('raw telemetry page plays the same feed',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/view-stream.html'+query);
  await expect(page.locator('#klv-output')).toContainText('DEMO-UAV');
  await expect(page.locator('#video-canvas')).toHaveAttribute('width','640');
  expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/raw-telemetry.png'});
});
test('experimental video material page initializes and receives video',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/video-test.html'+query);
  await expect(page.locator('#video-canvas')).toHaveAttribute('width','640');
  await page.waitForTimeout(500);
  await expect(page.locator('.cesium-widget-errorPanel')).toHaveCount(0);
  expect(errors).toEqual([]);
});
