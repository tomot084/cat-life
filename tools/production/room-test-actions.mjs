// Exercise the public direct-touch UI instead of the removed name buttons.
export async function selectRoomCat(page, key) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  const point = JSON.parse(await canvas.getAttribute(`data-${key}-screen`));
  await page.mouse.click(box.x + point.x, box.y + point.y);
}
export async function clickRoomAction(page, name) {
  if (name === 'ぷりん' || name === 'こころ') return selectRoomCat(page, name === 'ぷりん' ? 'purin' : 'kokoro');
  const button = page.getByRole('button', { name, exact: true });
  if (['視点を戻す', '配置を戻す', 'UIを隠す'].includes(name)) {
    const menu = page.locator('.global-menu');
    if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
    await button.click();
    if (name !== 'UIを隠す') await menu.locator('summary').click();
    return;
  }
  if (['なでる','ちゅーる','呼ぶ','ボールで遊ぶ','ねずみで遊ぶ','猫に寄る','タワーにのぼる','窓辺でひなたぼっこ'].includes(name)) {
    if (!(await page.locator('#cat-actions').isVisible())) await selectRoomCat(page, await page.locator('canvas').getAttribute('data-selected-cat') ?? 'purin');
    if (!(await button.isVisible())) await page.locator('#more-actions summary').click();
  }
  await button.click();
}
