
/**
 * tower_module.js (final corrected)
 * - Full, self-contained module for Tower game
 * - Proper SQL statements (no truncated strings)
 * - Interaction handlers for difficulty, tile pick, and cashout use deferUpdate + i.message.edit
 * - Locked gameplay (only starter can interact)
 * - Schema auto-heal for tiles & revealed_rows
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';

export default async function setupTower(client, db, createCanvas, loadImage, AttachmentBuilderUnused) {

  async function getProfitMode() {
    try {
      const row = await new Promise((res, rej) => db.get(
        'SELECT config_value FROM bot_config WHERE config_key = ?',
        ['profit_mode'],
        (e, r) => e ? rej(e) : res(r)
      ));
      return row?.config_value === 'true';
    } catch (e) {
      return false;
    }
  }

  // Ensure correct schema for tower_games (auto-heal if missing columns)
  try {
    db.all("PRAGMA table_info(tower_games)", (err, rows) => {
      if (err) {
        console.error("Error checking tower_games schema:", err);
        return;
      }
      const hasTilesCol = rows && rows.some(r => r.name === "tiles");
      const hasRevealedRowsCol = rows && rows.some(r => r.name === "revealed_rows");
      if (!hasTilesCol || !hasRevealedRowsCol) {
        console.warn("⚠️ tower_games table missing columns. Recreating table...");
        db.serialize(() => {
          db.run("DROP TABLE IF EXISTS tower_games", (e) => {
            if (e) console.error("Error dropping old tower_games:", e);
          });
          db.run(`CREATE TABLE IF NOT EXISTS tower_games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            bet_amount REAL NOT NULL,
            mode TEXT NOT NULL,
            tiles TEXT NOT NULL,
            revealed_rows TEXT NOT NULL,
            current_row INTEGER DEFAULT 0,
            current_multiplier REAL DEFAULT 1.0,
            status TEXT DEFAULT 'choosing',
            created_at INTEGER NOT NULL
          );`, (err2) => {
            if (err2) console.error("Error creating tower_games:", err2);
            else console.log("✅ tower_games table created or OK");
          });
        });
      } else {
        console.log("✅ tower_games schema OK");
      }
    });
  } catch (e) {
    console.error("Schema auto-heal failed:", e);
  }

  const MAX_MULT = { easy: 14, medium: 30, hard: 50 };
  function calcMultiplier(mode, row) {
    const base = mode === 'easy' ? 1.25 : (mode === 'medium' ? 1.35 : 1.5);
    return Math.min(MAX_MULT[mode], Number((Math.pow(base, row)).toFixed(2)));
  }

  function generateTower(mode, profitMode) {
    const rows = [];
    for (let r = 0; r < 9; r++) {
      const arr = [false, false, false, false];
      let safeCount = mode === 'easy' ? 3 : (mode === 'medium' ? 2 : 1);
      if (profitMode) {
        safeCount = Math.max(1, safeCount - 1);
      }
      const positions = [0,1,2,3].sort(() => Math.random() - 0.5);
      for (let i = 0; i < safeCount; i++) arr[positions[i]] = true;
      rows.push(arr);
    }
    return rows;
  }

  // Drawing helpers
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawDiamond(ctx, cx, cy, size) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size/2);
    ctx.lineTo(cx + size/2, cy);
    ctx.lineTo(cx, cy + size/2);
    ctx.lineTo(cx - size/2, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - size/2, cy - size/2, cx + size/2, cy + size/2);
    g.addColorStop(0, '#60a5fa');
    g.addColorStop(1, '#bfdbfe');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#1e40af';
    ctx.stroke();
  }

  function drawDragon(ctx, cx, cy, size) {
    // simple stylized dragon head with fire
    // head
    ctx.beginPath();
    ctx.ellipse(cx, cy, size/2, size/2, 0, 0, Math.PI*2);
    ctx.fillStyle = '#b91c1c';
    ctx.fill();
    ctx.strokeStyle = '#7f1d1d';
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - size*0.18, cy - size*0.18, Math.max(1, size*0.06), 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size*0.18, cy - size*0.18, Math.max(1, size*0.06), 0, Math.PI*2);
    ctx.fill();
    // fire
    const fx = cx + size*0.48;
    const fy = cy;
    const fg = ctx.createLinearGradient(fx, fy - size*0.2, fx + size*0.45, fy + size*0.15);
    fg.addColorStop(0, '#ffb4a2');
    fg.addColorStop(0.5, '#ff6b6b');
    fg.addColorStop(1, '#facc15');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + size*0.12, fy - size*0.28, fx + size*0.28, fy);
    ctx.quadraticCurveTo(fx + size*0.4, fy + size*0.22, fx + size*0.18, fy + size*0.14);
    ctx.closePath();
    ctx.fill();
  }

  async function drawTower(user, bet, mode, tower, revealedRows, status, currentRow, currentMult) {
    const rows = 9, cols = 4;
    const tileSize = 72, margin = 10;
    const width = cols * (tileSize + margin) + 240;
    const height = rows * (tileSize + margin) + 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#07102a';
    ctx.fillRect(0, 0, width, height);

    // header
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Sans';
    ctx.fillText(`Tower — ${mode.toUpperCase()} mode`, 20, 34);
    ctx.font = '14px Sans';
    ctx.fillText(`Bet: ${bet} | Player: ${user.username || user.tag}`, 20, 56);

    revealedRows = revealedRows || [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * (tileSize + margin) + 20;
        const y = height - (r + 1) * (tileSize + margin) - 30;
        const safe = tower[r][c];
        const rowRevealed = revealedRows.includes(r);
        const fullReveal = (status !== 'active' && status !== 'choosing');

        // tile background
        roundRect(ctx, x, y, tileSize, tileSize, 12);
        ctx.fillStyle = rowRevealed || fullReveal ? '#0f1724' : '#263244';
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.stroke();

        if (rowRevealed || fullReveal) {
          if (safe) drawDiamond(ctx, x + tileSize/2, y + tileSize/2, tileSize * 0.6);
          else drawDragon(ctx, x + tileSize/2, y + tileSize/2, tileSize * 0.6);
        }
      }

      // multiplier on right
      const mx = cols * (tileSize + margin) + 40;
      const my = height - (r + 1) * (tileSize + margin) - 30 + tileSize / 2;
      ctx.fillStyle = '#facc15';
      ctx.font = '18px Sans';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${calcMultiplier(mode, r + 1)}x`, mx, my);
    }

    // footer
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Sans';
    ctx.textAlign = 'left';
    ctx.fillText(status === 'active' ? `Current Mult: ${currentMult.toFixed(2)}x` : `Game ended (${status})`, 20, height - 8);

    return canvas.toBuffer();
  }

  // ---- MESSAGE COMMAND ----
  client.on('messageCreate', async (msg) => {
    try {
      if (msg.author.bot) return;
      if (!msg.content.startsWith('.tower')) return;
      const parts = msg.content.trim().split(/\s+/);
      if (parts.length < 2) return msg.reply('Usage: .tower <bet>');
      const bet = Number(parts[1]);
      if (!bet || bet <= 0) return msg.reply('Invalid bet amount');

      const userRow = await new Promise((res, rej) => db.get('SELECT * FROM users WHERE id = ?', [msg.author.id], (e, r) => e ? rej(e) : res(r)));
      if (!userRow || userRow.balance < bet) return msg.reply('Insufficient balance');

      // deduct bet immediately
      await new Promise((res, rej) => db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [bet, msg.author.id], (e) => e ? rej(e) : res()));

      const now = Date.now();
      const gameId = await new Promise((res, rej) => db.run(
        'INSERT INTO tower_games (user_id, bet_amount, mode, tiles, revealed_rows, current_row, current_multiplier, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [msg.author.id, bet, '', JSON.stringify([]), JSON.stringify([]), 0, 1.0, 'choosing', now],
        function (e) { if (e) rej(e); else res(this.lastID); }
      ));

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tower_diff_${gameId}_easy`).setLabel('Easy').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tower_diff_${gameId}_medium`).setLabel('Medium').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tower_diff_${gameId}_hard`).setLabel('Hard').setStyle(ButtonStyle.Danger)
      );

      await msg.reply({ content: `<@${msg.author.id}> Choose difficulty`, components: [buttons] });
    } catch (err) {
      console.error("Error starting tower command:", err);
      try { await msg.reply('Error starting tower game.'); } catch (e) { console.error(e); }
    }
  });

  // ---- INTERACTIONS ----
  client.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    const id = i.customId;

    try {
      // difficulty pick
      if (id.startsWith('tower_diff_')) {
        await i.deferUpdate();
        const [, , gid, mode] = id.split('_');
        const gameId = Number(gid);

        const game = await new Promise((res, rej) => db.get('SELECT * FROM tower_games WHERE id = ?', [gameId], (e, r) => e ? rej(e) : res(r)));
        if (!game) {
          await i.followUp({ content: 'Game not found', ephemeral: true });
          return;
        }
        if (game.user_id !== i.user.id) {
          await i.followUp({ content: "❌ This isn't your Tower game!", ephemeral: true });
          return;
        }
        if (game.status !== 'choosing') {
          await i.followUp({ content: 'Already chosen', ephemeral: true });
          return;
        }

        const profitMode = await getProfitMode();
        const tower = generateTower(mode, profitMode);
        await new Promise((res, rej) => db.run('UPDATE tower_games SET mode = ?, tiles = ?, status = ? WHERE id = ?', [mode, JSON.stringify(tower), 'active', gameId], (e) => e ? rej(e) : res()));

        const buf = await drawTower(i.user, game.bet_amount, mode, tower, [], 'active', 0, 1.0);
        const attachment = new AttachmentBuilder(buf, { name: 'tower.png' });

        const rowButtons = new ActionRowBuilder();
        for (let c = 0; c < 4; c++) rowButtons.addComponents(new ButtonBuilder().setCustomId(`tower_pick_${gameId}_0_${c}`).setLabel(`Tile ${c+1}`).setStyle(ButtonStyle.Secondary));
        const cashBtn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tower_cash_${gameId}`).setLabel('Cashout').setStyle(ButtonStyle.Success));

        try {
          await i.message.edit({ content: `<@${i.user.id}> Tower started (${mode})`, files: [attachment], components: [rowButtons, cashBtn] });
        } catch (e) {
          console.error("Failed to edit message after difficulty selection:", e);
          await i.followUp({ content: 'Failed to start tower (message edit failed)', ephemeral: true });
        }
        return;
      }

      // tile pick
      if (id.startsWith('tower_pick_')) {
        await i.deferUpdate();
        const [, , gid, rowStr, colStr] = id.split('_');
        const gameId = Number(gid), row = Number(rowStr), col = Number(colStr);

        const game = await new Promise((res, rej) => db.get('SELECT * FROM tower_games WHERE id = ?', [gameId], (e, r) => e ? rej(e) : res(r)));
        if (!game) {
          await i.followUp({ content: 'Game not found', ephemeral: true });
          return;
        }
        if (game.user_id !== i.user.id) {
          await i.followUp({ content: "❌ This isn't your Tower game!", ephemeral: true });
          return;
        }
        if (game.status !== 'active') {
          await i.followUp({ content: 'Game over', ephemeral: true });
          return;
        }

        const tower = JSON.parse(game.tiles);
        const revealedRows = JSON.parse(game.revealed_rows || '[]');
        if (revealedRows.includes(row)) {
          await i.followUp({ content: 'Row already revealed', ephemeral: true });
          return;
        }

        let status = 'active';
        let newMult = game.current_multiplier;

        if (!tower[row][col]) {
          status = 'lost';
          newMult = 0;
          for (let r = 0; r < 9; r++) if (!revealedRows.includes(r)) revealedRows.push(r);
        } else {
          newMult = calcMultiplier(game.mode, row + 1);
          if (!revealedRows.includes(row)) revealedRows.push(row);
        }

        await new Promise((res, rej) => db.run('UPDATE tower_games SET revealed_rows = ?, current_row = ?, current_multiplier = ?, status = ? WHERE id = ?', [JSON.stringify(revealedRows), row + 1, newMult, status, gameId], (e) => e ? rej(e) : res()));

        const buf = await drawTower(i.user, game.bet_amount, game.mode, tower, revealedRows, status, row + 1, newMult);
        const attachment = new AttachmentBuilder(buf, { name: 'tower.png' });

        const comps = [];
        if (status === 'active' && row < 8) {
          const nextRow = new ActionRowBuilder();
          for (let c2 = 0; c2 < 4; c2++) nextRow.addComponents(new ButtonBuilder().setCustomId(`tower_pick_${gameId}_${row+1}_${c2}`).setLabel(`Tile ${c2+1}`).setStyle(ButtonStyle.Secondary));
          comps.push(nextRow);
          comps.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tower_cash_${gameId}`).setLabel('Cashout').setStyle(ButtonStyle.Success)));
        }

        try {
          await i.message.edit({ content: `<@${i.user.id}> ${status === 'lost' ? 'You hit a dragon! ☠️' : 'Row cleared!'}`, files: [attachment], components: comps });
        } catch (e) {
          console.error("Failed to edit message after tile pick:", e);
          await i.followUp({ content: 'Failed to update game message', ephemeral: true });
        }
        return;
      }

      // cashout
      if (id.startsWith('tower_cash_')) {
        await i.deferUpdate();
        const [, , gid] = id.split('_');
        const gameId = Number(gid);

        const game = await new Promise((res, rej) => db.get('SELECT * FROM tower_games WHERE id = ?', [gameId], (e, r) => e ? rej(e) : res(r)));
        if (!game) {
          await i.followUp({ content: 'Game not found', ephemeral: true });
          return;
        }
        if (game.user_id !== i.user.id) {
          await i.followUp({ content: "❌ This isn't your Tower game!", ephemeral: true });
          return;
        }
        if (game.status !== 'active') {
          await i.followUp({ content: 'Game over', ephemeral: true });
          return;
        }

        const tower = JSON.parse(game.tiles);
        const revealedRows = JSON.parse(game.revealed_rows || '[]');
        const winnings = Number((game.bet_amount * game.current_multiplier).toFixed(2));
        for (let r = 0; r < 9; r++) if (!revealedRows.includes(r)) revealedRows.push(r);

        try {
          await new Promise((res, rej) => {
            db.serialize(() => {
              db.run('BEGIN TRANSACTION');
              db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, game.user_id], (e) => { if (e) { db.run('ROLLBACK'); return rej(e); } });
              db.run('UPDATE tower_games SET status = ?, revealed_rows = ? WHERE id = ?', ['cashed_out', JSON.stringify(revealedRows), gameId], (e) => { if (e) { db.run('ROLLBACK'); return rej(e); } });
              db.run('COMMIT', (e) => e ? rej(e) : res());
            });
          });
        } catch (e) {
          console.error("Transaction failed during cashout:", e);
          await i.followUp({ content: 'Cashout failed (DB error)', ephemeral: true });
          return;
        }

        const buf = await drawTower(i.user, game.bet_amount, game.mode, tower, revealedRows, 'cashed_out', game.current_row, game.current_multiplier);
        const attachment = new AttachmentBuilder(buf, { name: 'tower.png' });

        try {
          await i.message.edit({ content: `<@${i.user.id}> Cashed out ${winnings} at ${game.current_multiplier}x`, files: [attachment], components: [] });
        } catch (e) {
          console.error("Failed to edit message after cashout:", e);
          await i.followUp({ content: 'Failed to update game message after cashout', ephemeral: true });
        }
        return;
      }
    } catch (err) {
      console.error("Tower interaction error:", err);
      try {
        if (!i.replied && !i.deferred) await i.reply({ content: 'Tower interaction error', ephemeral: true });
        else await i.followUp({ content: 'Tower interaction error', ephemeral: true });
      } catch (e) { console.error("Failed to send interaction error reply:", e); }
    }
  });

  console.log("✅ tower_module loaded");
}
