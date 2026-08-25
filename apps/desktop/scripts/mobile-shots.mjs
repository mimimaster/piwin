import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = '/Users/yorickjue/.gemini/antigravity/brain/37f494b0-f549-4361-963e-24437c4bc1b7/shots';
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  const page = await context.newPage();

  console.log('Navigating to mobile app on http://localhost:1421/# ...');
  await page.goto('http://localhost:1421/#');
  await page.waitForTimeout(800);

  // If Connection screen is visible, click Connect
  const connectBtn = page.getByRole('button', { name: '连接' });
  if (await connectBtn.isVisible()) {
    console.log('Clicking Connect button...');
    await connectBtn.click();
    await page.waitForTimeout(2000);
  }

  // 1. Main Chat View (Obsidian Dark)
  console.log('Capturing main chat view (Obsidian)...');
  await page.evaluate(() => {
    window.location.hash = '';
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-color-mode', 'dark');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '01_main_chat_obsidian.png') });

  // 2. Sidebar Drawer View
  console.log('Capturing sidebar drawer...');
  await page.evaluate(() => {
    window.location.hash = '#sidebar';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '02_sidebar_drawer.png') });

  // 3. Model & Thinking Picker View
  console.log('Capturing model & thinking picker...');
  await page.evaluate(() => {
    window.location.hash = '#model-picker';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '03_model_thinking_picker.png') });

  // 4. Settings & Theme Selection View
  console.log('Capturing settings & themes...');
  await page.evaluate(() => {
    window.location.hash = '#settings';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '04_settings_theme.png') });

  // 5. Task Inbox View
  console.log('Capturing task inbox...');
  await page.evaluate(() => {
    window.location.hash = '#inbox';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '05_task_inbox.png') });

  // 6. Project Files & Changes View
  console.log('Capturing project files & changes...');
  await page.evaluate(() => {
    window.location.hash = '#files';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '06_project_files_changes.png') });

  // 7. Skills & MCP Inspector View
  console.log('Capturing skills & MCP inspector...');
  await page.evaluate(() => {
    window.location.hash = '#skills';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '07_skills_mcp_inspector.png') });

  // 8. Share & Export View
  console.log('Capturing share modal...');
  await page.evaluate(() => {
    window.location.hash = '#share';
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '08_share_export.png') });

  // 9. Bone Theme (Light Mode)
  console.log('Capturing Bone Light theme...');
  await page.evaluate(() => {
    window.location.hash = '';
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-color-mode', 'light');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '09_main_chat_bone_light.png') });

  // 10. Ink Wash Theme
  console.log('Capturing Ink Wash theme...');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'ink-wash');
    document.documentElement.setAttribute('data-color-mode', 'dark');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '10_main_chat_ink_wash.png') });

  await browser.close();
  console.log('All mobile screenshots captured successfully from localhost:1421!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
