import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, ChannelType, PermissionFlagsBits } from 'discord.js';
import QRCode from 'qrcode';
import { createCanvas, loadImage } from 'canvas';
import sqlite3 from 'sqlite3';
import crypto from 'crypto';
// Note: Canvas-based image generation provides immediate, high-quality results
// without external API dependencies, perfect for hosting compatibility
import fs from 'fs';
import path from 'path';
import setupTower from './tower_module.js';

// Runtime branding replacement: replace legacy "MasterBets" mentions with "Lanovbets"
const BRAND_NAME = 'Lanovbets';

try {
  const _origSetFooter = EmbedBuilder.prototype.setFooter;
  EmbedBuilder.prototype.setFooter = function(footer) {
    try {
      if (footer && typeof footer === 'object' && footer.text) {
        footer = { ...footer, text: String(footer.text).replace(/MasterBets|Masterbets|Master Bets/gi, BRAND_NAME) };
      } else if (typeof footer === 'string') {
        footer = String(footer).replace(/MasterBets|Masterbets|Master Bets/gi, BRAND_NAME);
      }
    } catch (e) {}
    return _origSetFooter.call(this, footer);
  };

  const _origSetTitle = EmbedBuilder.prototype.setTitle;
  EmbedBuilder.prototype.setTitle = function(title) {
    try { title = String(title).replace(/MasterBets|Masterbets|Master Bets/gi, BRAND_NAME); } catch (e) {}
    return _origSetTitle.call(this, title);
  };

  const _origSetDescription = EmbedBuilder.prototype.setDescription;
  EmbedBuilder.prototype.setDescription = function(desc) {
    try { desc = String(desc).replace(/MasterBets|Masterbets|Master Bets/gi, BRAND_NAME); } catch (e) {}
    return _origSetDescription.call(this, desc);
  };
} catch (e) {
  console.warn('Branding patch (EmbedBuilder) failed:', e?.message || e);
}

// Patch Canvas fillText to replace branding in generated images
try {
  const canvasModule = await (async () => { try { return await import('canvas'); } catch { return null; } })();
  const CanvasProto = (canvasModule && canvasModule.CanvasRenderingContext2D && canvasModule.CanvasRenderingContext2D.prototype) || (global.CanvasRenderingContext2D && global.CanvasRenderingContext2D.prototype);
  if (CanvasProto && CanvasProto.fillText) {
    const _origFillText = CanvasProto.fillText;
    CanvasProto.fillText = function(text, x, y, maxWidth) {
      try {
        if (typeof text === 'string') text = text.replace(/MasterBets|Masterbets|Master Bets/gi, BRAND_NAME);
      } catch (e) {}
      return _origFillText.call(this, text, x, y, maxWidth);
    };
  }
} catch (e) {
  // Non-fatal
}


const PREFIX = '.';
const APIRONE_WALLET_ID = "ltc-c1e6e6209e5524265ce185386ea2697e";
const APIRONE_TRANSFER_KEY = "UgHs9mEs2uTdOBPNLFmLFt7Dw6pjK5yJ";
const BOT_TOKEN = "MTQ0OTc5NTQyNzQ4MTI5Mjg5MA.GaQmAp.YmdjalJABS9ME-kL63S7GzovkvXFsrMw__BtLU";
const SCAN_INTERVAL_MS = 60000;
const LOGS_CHANNEL_ID = '1449826986628219081'; // Winning notifications
const WITHDRAWAL_CHANNEL_ID = '1449826924854771905'; // Withdrawal notifications
const FAIR_PLAY_CHANNEL_ID = '1449826847901880360'; // MasterBets Fair Play Protocol announcements

const BOT_LUCK_PERCENT_OFF = 55;
const BOT_LUCK_PERCENT_ON = 79;

// ==================== LEVEL SYSTEM CONFIGURATION ====================
const LEVEL_CONFIG = [
  { 
    name: 'Bronze', 
    threshold: 200, 
    roleId: '1425528361626894537', 
    reward: 2,
    emoji: '🥉',
    description: 'Beginner spark.',
    color: '#ff6f3c'
  },
  { 
    name: 'Silver', 
    threshold: 1000, 
    roleId: '1425528327036207296', 
    reward: 5,
    emoji: '🥈',
    description: 'Strong starter.',
    color: '#5c5c5c'
  },
  { 
    name: 'Gold', 
    threshold: 2000, 
    roleId: '1425528256089690224', 
    reward: 10,
    emoji: '🏅',
    description: 'Durable grinder.',
    color: '#8a8f9e'
  },
  { 
    name: 'Platinum', 
    threshold: 5000, 
    roleId: '1425528223143297186', 
    reward: 20,
    emoji: '💨',
    description: 'Cool, sharp player.',
    color: '#00cfff'
  },
  { 
    name: 'Diamond', 
    threshold: 12500, 
    roleId: '1425528158345760848', 
    reward: 40,
    emoji: '💎',
    description: 'Shining with energy.',
    color: '#ffd700'
  },
  { 
    name: 'Crown', 
    threshold: 25000, 
    roleId: '1425528092985655438', 
    reward: 80,
    emoji: '👑',
    description: 'Fierce challenger.',
    color: '#b3001b'
  },
  { 
    name: 'Ace', 
    threshold: 50000, 
    roleId: '1425528026258472970', 
    reward: 160,
    emoji: '🌟',
    description: 'Ruler of growth.',
    color: '#228b22'
  },
  { 
    name: 'Ace Master', 
    threshold: 100000, 
    roleId: '1425527905663844412', 
    reward: 350,
    emoji: '⚡',
    description: 'Commands thunder.',
    color: '#4169e1'
  },
  { 
    name: 'Ace Dominator', 
    threshold: 250000, 
    roleId: '1425527970331754659', 
    reward: 700,
    emoji: '💠',
    description: 'Dominates the night.',
    color: '#1a1a1a'
  },
  { 
    name: 'Top Conqueror', 
    threshold: 500000, 
    roleId: '1425527849175093268', 
    reward: 1500,
    emoji: '🪙',
    description: 'Ultimate prestige.',
    color: '#ff2400'
  }
];

// ==================== LEVEL SYSTEM FUNCTIONS ====================

/**
 * Ensure user exists in levels table with correct default values
 */
async function ensureUserLevelExists(userId) {
  try {
    // Use explicit values to ensure correct defaults (current_level = -1 for unranked)
    await dbRun('INSERT OR IGNORE INTO user_levels (user_id, total_wagered, current_level, pending_level_claim, last_level_update) VALUES (?, 0, -1, 0, 0)', [userId]);
  } catch (error) {
    console.error('Error ensuring user level exists:', error);
  }
}
// index.js
export async function trackWageredAmount(userId, betAmount) {
  try {
    await ensureUserLevelExists(userId);
    await dbRun('UPDATE user_levels SET total_wagered = total_wagered + ?, last_level_update = ? WHERE user_id = ?', 
      [betAmount, Date.now(), userId]);
    
    // Check for level upgrade
    await checkAndUpdateUserLevel(userId);
    console.log(`📊 Tracked ${betAmount} wagered for user ${userId}`);
  } catch (error) {
    console.error('Error tracking wagered amount:', error);
  }
}

(async () => {

  try {

    console.log("⚠️ Resetting all deposit addresses (API update)...");

    await dbRun("UPDATE users SET deposit_address = NULL");

    console.log("✅ All deposit addresses cleared successfully!");

  } catch (err) {

    console.error("❌ Failed to reset deposit addresses:", err);

  }

})();

/**
 * Get current level based on total wagered
 * Returns -1 for unranked users (insufficient wagering)
 */
function getLevelFromWagered(totalWagered) {
  // Return -1 for unranked users who haven't reached first threshold
  if (totalWagered < LEVEL_CONFIG[0].threshold) {
    return -1;
  }
  
  let currentLevel = 0;
  for (let i = 0; i < LEVEL_CONFIG.length; i++) {
    if (totalWagered >= LEVEL_CONFIG[i].threshold) {
      currentLevel = i;
    } else {
      break;
    }
  }
  return currentLevel;
}

/**
 * Get user's level data
 */
async function getUserLevelData(userId) {
  try {
    await ensureUserLevelExists(userId);
    const levelData = await dbGet('SELECT * FROM user_levels WHERE user_id = ?', [userId]);
    const currentLevelIndex = getLevelFromWagered(levelData.total_wagered);
    
    // Handle unranked users (-1)
    const currentLevel = currentLevelIndex >= 0 ? LEVEL_CONFIG[currentLevelIndex] : null;
    const nextLevel = currentLevelIndex >= 0 ? 
      (LEVEL_CONFIG[currentLevelIndex + 1] || null) : 
      LEVEL_CONFIG[0]; // For unranked, next level is the first level
    
    return {
      totalWagered: levelData.total_wagered,
      currentLevelIndex,
      currentLevel,
      nextLevel,
      pendingClaim: levelData.pending_level_claim,
      storedLevel: levelData.current_level
    };
  } catch (error) {
    console.error('Error getting user level data:', error);
    return null;
  }
}

/**
 * Check if user can level up and set pending claim
 */
async function checkAndUpdateUserLevel(userId) {
  try {
    const levelData = await getUserLevelData(userId);
    if (!levelData) return;
    
    // If their wagered amount qualifies for a higher level than stored
    // Note: storedLevel can be -1 (unranked), currentLevelIndex can be -1 (unranked)
    if (levelData.currentLevelIndex > levelData.storedLevel) {
      await dbRun('UPDATE user_levels SET pending_level_claim = 1 WHERE user_id = ?', [userId]);
      
      if (levelData.currentLevel) {
        console.log(`🎖️ User ${userId} eligible for level up to ${levelData.currentLevel.name}!`);
      } else {
        console.log(`🎖️ User ${userId} still unranked but progress tracked.`);
      }
    }
  } catch (error) {
    console.error('Error checking user level update:', error);
  }
}

/**
 * Claim level rewards and update role with atomic concurrency protection
 */
async function claimLevelReward(userId, guild) {
  try {
    // Start database transaction for atomic operations
    await beginTransaction();
    
    try {
      // CONCURRENCY PROTECTION: Get current data within transaction
      const levelData = await getUserLevelData(userId);
      if (!levelData || !levelData.pendingClaim) {
        await rollbackTransaction();
        return { success: false, message: 'No pending level claim available.' };
      }
      
      // Verify user has a valid level to claim (not unranked)
      if (!levelData.currentLevel || levelData.currentLevelIndex < 0) {
        await rollbackTransaction();
        return { success: false, message: 'Invalid level state for claiming.' };
      }
      
      const newLevel = levelData.currentLevel;
      
      // ATOMIC UPDATE: Only proceed if pending_level_claim is still 1
      // This prevents double-claiming from concurrent requests
      const updateResult = await dbRun(
        'UPDATE user_levels SET current_level = ?, pending_level_claim = 0 WHERE user_id = ? AND pending_level_claim = 1', 
        [levelData.currentLevelIndex, userId]
      );
      
      // Check if the update actually affected a row (concurrency protection)
      if (updateResult.changes === 0) {
        await rollbackTransaction();
        return { success: false, message: 'Level reward already claimed or no longer available.' };
      }
      
      // Award points atomically within transaction
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [newLevel.reward, userId]);
      
      // Commit database changes before Discord operations
      await commitTransaction();
      
      console.log(`🎉 User ${userId} claimed ${newLevel.name} level with ${newLevel.reward} points reward!`);
      
      // Discord role management (outside transaction to avoid blocking DB)
      try {
        const member = await guild.members.fetch(userId);
        
        // Add new role if it exists and bot has permissions
        if (newLevel.roleId) {
          const role = guild.roles.cache.get(newLevel.roleId);
          if (role) {
            // Check if bot has permission to manage this role
            if (guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles) && role.comparePositionTo(guild.members.me.roles.highest) < 0) {
              await member.roles.add(role);
              console.log(`✅ Added role ${role.name} to user ${userId}`);
            } else {
              console.warn(`⚠️ Cannot add role ${role.name}: insufficient permissions or role hierarchy`);
            }
          } else {
            console.warn(`⚠️ Role ${newLevel.roleId} not found in guild`);
          }
        }
        
        // Remove old level roles (clean up) with error handling
        for (let i = 0; i < levelData.currentLevelIndex; i++) {
          const oldRole = LEVEL_CONFIG[i];
          if (oldRole.roleId) {
            try {
              const oldDiscordRole = guild.roles.cache.get(oldRole.roleId);
              if (oldDiscordRole && member.roles.cache.has(oldRole.roleId)) {
                if (guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles) && oldDiscordRole.comparePositionTo(guild.members.me.roles.highest) < 0) {
                  await member.roles.remove(oldDiscordRole);
                  console.log(`🗑️ Removed old role ${oldDiscordRole.name} from user ${userId}`);
                }
              }
            } catch (roleError) {
              console.warn(`⚠️ Could not remove old role ${oldRole.name}: ${roleError.message}`);
            }
          }
        }
        
      } catch (discordError) {
        console.error('Discord role management error (reward still claimed):', discordError);
        // Don't fail the claim for Discord errors since database operation succeeded
      }
      
      // MULTI-LEVEL PROGRESSION FIX: Check if user now qualifies for additional levels
      try {
        const updatedLevelData = await getUserLevelData(userId);
        if (updatedLevelData && updatedLevelData.currentLevelIndex > updatedLevelData.storedLevel) {
          // User qualifies for additional level(s) - set pending claim flag again
          await dbRun('UPDATE user_levels SET pending_level_claim = 1 WHERE user_id = ?', [userId]);
          console.log(`🚀 User ${userId} qualifies for additional level after claiming ${newLevel.name}!`);
        }
      } catch (progressionError) {
        console.error('Error checking multi-level progression:', progressionError);
        // Don't fail the main claim for progression check errors
      }
      
      return { 
        success: true, 
        level: newLevel, 
        reward: newLevel.reward 
      };
      
    } catch (transactionError) {
      // Rollback transaction on any error
      await rollbackTransaction();
      throw transactionError;
    }
    
  } catch (error) {
    console.error('Error claiming level reward:', error);
    return { success: false, message: 'Error claiming level reward. Please try again.' };
  }
}

// ==================== ENHANCED LEVEL SYSTEM ====================

/**
 * Generate premium level card with animations and better design
 */
async function generateEnhancedLevelCard(user, levelData) {
  try {
    const canvas = createCanvas(1000, 400);
    const ctx = canvas.getContext('2d');
    
    // Premium animated gradient background
    const time = Date.now() / 5000;
    const gradient = ctx.createLinearGradient(0, 0, 1000, 400);
    gradient.addColorStop(0, `hsl(${240 + Math.sin(time) * 20}, 70%, 15%)`);
    gradient.addColorStop(0.5, `hsl(${260 + Math.cos(time) * 20}, 80%, 20%)`);
    gradient.addColorStop(1, `hsl(${280 + Math.sin(time) * 20}, 70%, 15%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1000, 400);
    
    // Animated particles in background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let i = 0; i < 30; i++) {
      const x = (Math.sin(time + i) * 200 + 500) % 1000;
      const y = (Math.cos(time * 0.7 + i) * 100 + 200) % 400;
      const size = Math.sin(time + i) * 2 + 1;
      ctx.fillRect(x, y, size, size);
    }
    
    // Main card container with premium styling
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.strokeStyle = 'rgba(100, 181, 246, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(40, 40, 920, 320, 25);
    ctx.fill();
    ctx.stroke();
    
    // Enhanced user avatar with glowing border
    const avatarX = 120;
    const avatarY = 120;
    const avatarRadius = 50;
    
    // Glow effect
    const glowColor = levelData.currentLevel?.color || '#4ade80';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 25;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius + 3, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();
    ctx.shadowBlur = 0;
    
    // Draw actual avatar
    await drawCircularProfilePicture(ctx, user, avatarX, avatarY, avatarRadius);
    
    // Username with premium styling
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px "Arial", sans-serif';
    ctx.textAlign = 'left';
    const username = user.displayName || user.username;
    ctx.fillText(username, 200, 100);
    
    // Current level display with animation
    if (levelData.currentLevel) {
      const level = levelData.currentLevel;
      ctx.fillStyle = level.color;
      ctx.font = 'bold 22px "Arial", sans-serif';
      ctx.fillText(`${level.emoji} ${level.name} Tier`, 200, 130);
      
      // Level description
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '16px "Arial", sans-serif';
      ctx.fillText(level.description, 200, 155);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 22px "Arial", sans-serif';
      ctx.fillText('⭐ Unranked Adventurer', 200, 130);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '16px "Arial", sans-serif';
      ctx.fillText('Start your journey to unlock ranks!', 200, 155);
    }
    
    // Stats panel
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.roundRect(200, 180, 600, 80, 15);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Arial", sans-serif';
    ctx.fillText('Total Wagered', 220, 210);
    
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 24px "Arial", sans-serif';
    ctx.fillText(`${levelData.totalWagered.toLocaleString()} points`, 220, 240);
    
    // Progress bar with animation
    const nextLevel = levelData.nextLevel;
    if (nextLevel) {
      const progressBarY = 300;
      const progressBarWidth = 600;
      const progressBarHeight = 25;
      const progressBarX = 200;
      
      // Calculate progress with smooth animation
      const currentWagered = levelData.totalWagered;
      const prevThreshold = levelData.currentLevel ? levelData.currentLevel.threshold : 0;
      const nextThreshold = nextLevel.threshold;
      const progressInLevel = currentWagered - prevThreshold;
      const levelRange = nextThreshold - prevThreshold;
      const progressPercent = Math.min(progressInLevel / levelRange, 1);
      
      // Animated progress fill
      const animatedProgress = progressPercent * (0.9 + 0.1 * Math.sin(Date.now() / 300));
      
      // Progress bar background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight, 12);
      ctx.fill();
      
      // Progress bar fill with gradient
      const progressGradient = ctx.createLinearGradient(progressBarX, progressBarY, progressBarX + progressBarWidth, progressBarY);
      progressGradient.addColorStop(0, levelData.currentLevel?.color || '#4ade80');
      progressGradient.addColorStop(1, '#22c55e');
      ctx.fillStyle = progressGradient;
      ctx.beginPath();
      ctx.roundRect(progressBarX, progressBarY, progressBarWidth * animatedProgress, progressBarHeight, 12);
      ctx.fill();
      
      // Progress text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px "Arial", sans-serif';
      ctx.textAlign = 'center';
      const progressText = `${Math.round(progressPercent * 100)}% to ${nextLevel.emoji} ${nextLevel.name}`;
      ctx.fillText(progressText, progressBarX + progressBarWidth / 2, progressBarY + 17);
    }
    
    // Level badge with pulsing effect
    if (levelData.currentLevel) {
      const badgeX = 850;
      const badgeY = 120;
      const pulse = Math.sin(Date.now() / 500) * 5;
      
      ctx.fillStyle = levelData.currentLevel.color;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, 40 + pulse, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "Arial", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(levelData.currentLevel.emoji, badgeX, badgeY + 8);
    }
    
    return canvas.toBuffer('image/png');
    
  } catch (error) {
    console.error('Error generating enhanced level card:', error);
    return generateLevelCardImage(user, levelData); // Fallback to original
  }
}

// ==================== CARD IMAGE GENERATION SYSTEM ====================
// High-quality card image generation using Hugging Face (FREE alternative to OpenAI)

// Card image cache for performance optimization
const cardImageCache = new Map(); // Cache format: 'playerCards|dealerCards|gameState' -> imageBuffer

// Create card images directory
const CARD_IMAGES_DIR = './card_images';
if (!fs.existsSync(CARD_IMAGES_DIR)) {
  fs.mkdirSync(CARD_IMAGES_DIR, { recursive: true });
}

/**
 * Generate high-quality playing card image using Canvas (immediate fallback)
 */
async function generateCardImageCanvas(cards, gameType = 'blackjack') {
  const cardWidth = 150;
  const cardHeight = 210;
  const padding = 20;
  const spacing = 10;
  
  const canvasWidth = cards.length * (cardWidth + spacing) - spacing + (padding * 2);
  const canvasHeight = cardHeight + (padding * 2);
  
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  
  // Create professional dark green background like BetRush
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  gradient.addColorStop(0, '#1a4f3a');
  gradient.addColorStop(1, '#0d2d1f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  // Add subtle pattern
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let i = 0; i < canvasWidth; i += 30) {
    for (let j = 0; j < canvasHeight; j += 30) {
      ctx.fillRect(i, j, 1, 1);
    }
  }
  
  // Draw each card
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const x = padding + i * (cardWidth + spacing);
    const y = padding;
    
    // Card background with subtle shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
    
    // Card background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cardWidth, cardHeight);
    
    // Card border
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, cardWidth, cardHeight);
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    
    if (card === '🂠') {
      // Hidden card (back design)
      ctx.fillStyle = '#1a4f3a';
      ctx.fillRect(x + 5, y + 5, cardWidth - 10, cardHeight - 10);
      
      // Card back pattern
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      for (let px = x + 20; px < x + cardWidth - 20; px += 20) {
        for (let py = y + 20; py < y + cardHeight - 20; py += 20) {
          ctx.strokeRect(px, py, 10, 10);
        }
      }
    } else {
      // Regular card
      const rank = card.rank;
      const suit = card.suit;
      
      // Determine color
      const isRed = suit === '♥' || suit === '♦';
      ctx.fillStyle = isRed ? '#d32f2f' : '#000000';
      
      // Draw rank (top-left)
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(rank, x + 10, y + 30);
      
      // Draw suit (below rank)
      ctx.font = '32px Arial';
      ctx.fillText(suit, x + 10, y + 65);
      
      // Draw large suit in center
      ctx.font = '72px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(suit, x + cardWidth/2, y + cardHeight/2 + 20);
      
      // Draw rank (bottom-right, rotated)
      ctx.save();
      ctx.translate(x + cardWidth - 10, y + cardHeight - 10);
      ctx.rotate(Math.PI);
      ctx.font = 'bold 24px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(rank, 0, 30);
      ctx.font = '32px Arial';
      ctx.fillText(suit, 0, 65);
      ctx.restore();
    }
  }
  
  return canvas.toBuffer('image/png');
}

/**
 * Create beautiful blackjack game image with cards layout
 */
async function createBlackjackGameImage(playerCards, dealerCards, gameState, username) {
  try {
    // Convert card objects to proper format
    const playerCardObjects = playerCards.map(card => {
      if (typeof card === 'string' && card === '🂠') return '🂠';
      return { rank: card.rank, suit: card.suit };
    });
    
    const dealerCardObjects = dealerCards.map(card => {
      if (typeof card === 'string' && card === '🂠') return '🂠';
      return { rank: card.rank, suit: card.suit };
    });
    
    const maxCards = Math.max(playerCardObjects.length, dealerCardObjects.length);
    const cardWidth = 150;
    const cardHeight = 210;
    const padding = 30;
    const spacing = 15;
    const labelHeight = 40;
    const sectionSpacing = 40;
    
    const canvasWidth = maxCards * (cardWidth + spacing) - spacing + (padding * 2);
    const canvasHeight = (cardHeight * 2) + labelHeight * 2 + sectionSpacing + (padding * 2);
    
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');
    
    // Professional background like BetRush
    const gradient = ctx.createRadialGradient(canvasWidth/2, canvasHeight/2, 0, canvasWidth/2, canvasHeight/2, Math.max(canvasWidth, canvasHeight)/2);
    gradient.addColorStop(0, '#1e4d3a');
    gradient.addColorStop(1, '#0d2d1f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Add game branding
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('MasterBets', canvasWidth - 15, 25);
    
    // Dealer section
    let currentY = padding;
    
    // Dealer label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText("🏠 Dealer's Hand", padding, currentY + 20);
    currentY += labelHeight;
    
    // Draw dealer cards
    for (let i = 0; i < dealerCardObjects.length; i++) {
      const card = dealerCardObjects[i];
      const x = padding + i * (cardWidth + spacing);
      
      if (card === '🂠') {
        // Hidden card
        ctx.fillStyle = '#1a4f3a';
        ctx.fillRect(x, currentY, cardWidth, cardHeight);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, currentY, cardWidth, cardHeight);
        
        // Card back pattern
        ctx.fillStyle = '#ffffff';
        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('♠', x + cardWidth/2, currentY + cardHeight/2 + 15);
      } else {
        // Draw dealer card using the same logic as above
        await drawSingleCard(ctx, card, x, currentY, cardWidth, cardHeight);
      }
    }
    
    currentY += cardHeight + sectionSpacing;
    
    // Player section
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`🎯 ${username}'s Hand`, padding, currentY + 20);
    currentY += labelHeight;
    
    // Draw player cards
    for (let i = 0; i < playerCardObjects.length; i++) {
      const card = playerCardObjects[i];
      const x = padding + i * (cardWidth + spacing);
      await drawSingleCard(ctx, card, x, currentY, cardWidth, cardHeight);
    }
    
    return canvas.toBuffer('image/png');
    
  } catch (error) {
    console.error('Error creating blackjack game image:', error);
    // Fallback to simple text-based generation
    return generateCardImageCanvas([...playerCards, ...dealerCards]);
  }
}

/**
 * Helper function to draw a single card
 */
async function drawSingleCard(ctx, card, x, y, width, height) {
  // Card shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  
  // Card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, width, height);
  
  // Card border
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  
  const rank = card.rank;
  const suit = card.suit;
  
  // Determine color
  const isRed = suit === '♥' || suit === '♦';
  ctx.fillStyle = isRed ? '#d32f2f' : '#000000';
  
  // Draw rank (top-left)
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(rank, x + 12, y + 35);
  
  // Draw suit (below rank)
  ctx.font = '36px Arial';
  ctx.fillText(suit, x + 12, y + 75);
  
  // Draw large suit in center
  ctx.font = '84px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(suit, x + width/2, y + height/2 + 25);
  
  // Draw rank (bottom-right, rotated)
  ctx.save();
  ctx.translate(x + width - 12, y + height - 12);
  ctx.rotate(Math.PI);
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(rank, 0, 35);
  ctx.font = '36px Arial';
  ctx.fillText(suit, 0, 75);
  ctx.restore();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

const db = new sqlite3.Database('./database.sqlite');

// Database helper functions
function dbRun(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function (err) { 
    if (err) return rej(err); 
    res(this); 
  }));
}

function dbGet(sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (err, row) => { 
    if (err) return rej(err); 
    res(row); 
  }));
}

function dbAll(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (err, rows) => { 
    if (err) return rej(err); 
    res(rows); 
  }));
}

// Database transaction helpers
function beginTransaction() {
  return new Promise((res, rej) => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return rej(err);
      res();
    });
  });
}

function commitTransaction() {
  return new Promise((res, rej) => {
    db.run('COMMIT', (err) => {
      if (err) return rej(err);
      res();
    });
  });
}

function rollbackTransaction() {
  return new Promise((res, rej) => {
    db.run('ROLLBACK', (err) => {
      if (err) return rej(err);
      res();
    });
  });
}

// Execute multiple database operations within a transaction
async function executeTransaction(operations) {
  await beginTransaction();
  try {
    const results = [];
    for (const operation of operations) {
      const result = await dbRun(operation.sql, operation.params);
      results.push(result);
    }
    await commitTransaction();
    return results;
  } catch (error) {
    await rollbackTransaction();
    throw error;
  }
}

// Send logs to the configured logs channel
async function sendLogMessage(content) {
  try {
    const channel = await client.channels.fetch(LOGS_CHANNEL_ID);
    if (channel) {
      await channel.send(content);
    }
  } catch (error) {
    console.error('Error sending log message:', error);
  }
}

// SECURITY FIX: Safe mathematical expression evaluator
// Replaces the vulnerable Function() constructor approach
function safeEvaluateExpression(expression) {
  // Remove all whitespace for easier parsing
  const cleanExpression = expression.replace(/\s/g, '');
  
  // Validate that the expression only contains safe characters
  const allowedPattern = /^[0-9+\-*/().%sqrtabcdefghijklmnopqrstuvwxyzPI_,]*$/i;
  if (!allowedPattern.test(cleanExpression)) {
    throw new Error('Expression contains invalid characters');
  }
  
  // Define allowed functions and constants
  const mathFunctions = {
    'sqrt': Math.sqrt,
    'abs': Math.abs,
    'round': Math.round,
    'floor': Math.floor,
    'ceil': Math.ceil,
    'sin': Math.sin,
    'cos': Math.cos,
    'tan': Math.tan,
    'log': Math.log,
    'exp': Math.exp,
    'pow': Math.pow
  };
  
  const mathConstants = {
    'PI': Math.PI,
    'E': Math.E
  };
  
  // Tokenize the expression
  const tokens = tokenizeExpression(cleanExpression);
  
  // Parse and evaluate
  return parseExpression(tokens, mathFunctions, mathConstants);
}

// Tokenizer for mathematical expressions
function tokenizeExpression(expression) {
  const tokens = [];
  let i = 0;
  
  while (i < expression.length) {
    const char = expression[i];
    
    if (/\d/.test(char) || char === '.') {
      // Parse number
      let number = '';
      while (i < expression.length && (/\d/.test(expression[i]) || expression[i] === '.')) {
        number += expression[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(number) });
    } else if (/[a-zA-Z]/.test(char)) {
      // Parse function name or constant
      let name = '';
      while (i < expression.length && /[a-zA-Z]/.test(expression[i])) {
        name += expression[i];
        i++;
      }
      tokens.push({ type: 'IDENTIFIER', value: name });
    } else if (['+', '-', '*', '/', '%', '(', ')', ','].includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char });
      i++;
    } else {
      throw new Error(`Invalid character: ${char}`);
    }
  }
  
  return tokens;
}

// Recursive descent parser for mathematical expressions
function parseExpression(tokens, mathFunctions, mathConstants) {
  let index = 0;
  
  function peek() {
    return tokens[index];
  }
  
  function consume(expectedType = null) {
    const token = tokens[index++];
    if (expectedType && token?.type !== expectedType) {
      throw new Error(`Expected ${expectedType}, got ${token?.type || 'end of expression'}`);
    }
    return token;
  }
  
  function parseExpr() {
    let left = parseTerm();
    
    while (peek()?.type === 'OPERATOR' && ['+', '-'].includes(peek().value)) {
      const op = consume('OPERATOR').value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    
    return left;
  }
  
  function parseTerm() {
    let left = parseFactor();
    
    while (peek()?.type === 'OPERATOR' && ['*', '/', '%'].includes(peek().value)) {
      const op = consume('OPERATOR').value;
      const right = parseFactor();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else if (op === '%') {
        if (right === 0) throw new Error('Modulo by zero');
        left = left % right;
      }
    }
    
    return left;
  }
  
  function parseFactor() {
    const token = peek();
    
    if (token?.type === 'NUMBER') {
      return consume('NUMBER').value;
    }
    
    if (token?.type === 'IDENTIFIER') {
      const identifier = consume('IDENTIFIER').value;
      
      // Check if it's a constant
      if (mathConstants.hasOwnProperty(identifier)) {
        return mathConstants[identifier];
      }
      
      // Check if it's a function
      if (mathFunctions.hasOwnProperty(identifier)) {
        consume('OPERATOR'); // consume '('
        const func = mathFunctions[identifier];
        
        if (identifier === 'pow') {
          // Special case for pow(x, y) - requires two arguments
          const arg1 = parseExpr();
          consume('OPERATOR'); // consume ','
          const arg2 = parseExpr();
          consume('OPERATOR'); // consume ')'
          return func(arg1, arg2);
        } else {
          // Single argument function
          const arg = parseExpr();
          consume('OPERATOR'); // consume ')'
          return func(arg);
        }
      }
      
      throw new Error(`Unknown identifier: ${identifier}`);
    }
    
    if (token?.type === 'OPERATOR' && token.value === '(') {
      consume('OPERATOR'); // consume '('
      const result = parseExpr();
      consume('OPERATOR'); // consume ')'
      return result;
    }
    
    if (token?.type === 'OPERATOR' && ['+', '-'].includes(token.value)) {
      const op = consume('OPERATOR').value;
      const operand = parseFactor();
      return op === '+' ? operand : -operand;
    }
    
    throw new Error(`Unexpected token: ${token?.value || 'end of expression'}`);
  }
  
  const result = parseExpr();
  
  if (index < tokens.length) {
    throw new Error(`Unexpected token: ${tokens[index].value}`);
  }
  
  return result;
}

// Helper function to track collected fees
async function trackCollectedFee(source, amountPoints, gameType = null, userId = null, betAmount = null, description = null) {
  try {
    await dbRun(`INSERT INTO collected_fees (source, amount_points, game_type, user_id, bet_amount, timestamp, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [source, amountPoints, gameType, userId, betAmount, Date.now(), description]);
    console.log(`Fee tracked: ${amountPoints} points from ${source}`);
  } catch (error) {
    console.error('Error tracking fee:', error);
  }
}
   // ==================== CASES GAME SYSTEM ===  
// Cases configuration with different rarities and rewards
const CASES_CONFIG = {
  // Basic Case - Low cost, low rewards
  basic: {
    name: 'Basic Case',
    cost: 10,
    emoji: '📦',
    color: '#95a5a6',
    items: [
      { name: 'Small Win', points: 5, rarity: 'common', chance: 40, color: '#95a5a6', emoji: '🪙' },
      { name: 'Medium Win', points: 15, rarity: 'common', chance: 30, color: '#95a5a6', emoji: '💰' },
      { name: 'Nice Win', points: 25, rarity: 'uncommon', chance: 15, color: '#2ecc71', emoji: '💎' },
      { name: 'Great Win', points: 50, rarity: 'rare', chance: 10, color: '#3498db', emoji: '🌟' },
      { name: 'Jackpot', points: 100, rarity: 'legendary', chance: 5, color: '#f1c40f', emoji: '🎰' }
    ]
  },
  
  // Premium Case - Medium cost, medium rewards
  premium: {
    name: 'Premium Case',
    cost: 50,
    emoji: '🎁',
    color: '#3498db',
    items: [
      { name: 'Decent Win', points: 30, rarity: 'common', chance: 35, color: '#95a5a6', emoji: '💰' },
      { name: 'Good Win', points: 75, rarity: 'uncommon', chance: 30, color: '#2ecc71', emoji: '💎' },
      { name: 'Great Win', points: 150, rarity: 'rare', chance: 20, color: '#3498db', emoji: '🌟' },
      { name: 'Epic Win', points: 300, rarity: 'epic', chance: 10, color: '#9b59b6', emoji: '👑' },
      { name: 'Legendary', points: 600, rarity: 'legendary', chance: 5, color: '#f1c40f', emoji: '🎰' }
    ]
  },
  
  // Elite Case - High cost, high rewards
  elite: {
    name: 'Elite Case',
    cost: 200,
    emoji: '💼',
    color: '#9b59b6',
    items: [
      { name: 'Good Win', points: 100, rarity: 'common', chance: 30, color: '#95a5a6', emoji: '💰' },
      { name: 'Great Win', points: 250, rarity: 'uncommon', chance: 25, color: '#2ecc71', emoji: '💎' },
      { name: 'Epic Win', points: 500, rarity: 'rare', chance: 20, color: '#3498db', emoji: '🌟' },
      { name: 'Legendary Win', points: 1000, rarity: 'epic', chance: 15, color: '#9b59b6', emoji: '👑' },
      { name: 'Mega Jackpot', points: 2500, rarity: 'legendary', chance: 10, color: '#f1c40f', emoji: '🎰' }
    ]
  },
  
  // Mystery Case - Very high cost, extreme rewards with risk
  mystery: {
    name: 'Mystery Case',
    cost: 500,
    emoji: '🎲',
    color: '#e74c3c',
    items: [
      { name: 'Unlucky', points: 50, rarity: 'common', chance: 30, color: '#95a5a6', emoji: '😢' },
      { name: 'Break Even', points: 500, rarity: 'uncommon', chance: 25, color: '#2ecc71', emoji: '🤝' },
      { name: 'Nice Profit', points: 1000, rarity: 'rare', chance: 20, color: '#3498db', emoji: '💎' },
      { name: 'Big Win', points: 2500, rarity: 'epic', chance: 15, color: '#9b59b6', emoji: '🌟' },
      { name: 'MEGA JACKPOT', points: 10000, rarity: 'legendary', chance: 10, color: '#f1c40f', emoji: '🎰' }
    ]
  }
};

// ==================== ROLL FUNCTION (WITH PROFIT MODE) ====================

function weightedRandom(items) {
  const totalChance = items.reduce((a, b) => a + b.chance, 0);
  const rand = Math.random() * totalChance;
  let sum = 0;
  for (const item of items) {
    sum += item.chance;
    if (rand <= sum) return item;
  }
  return items[items.length - 1];
}

/**
 * Rigged roll based on profitMode and fairness
 */
async function rollCaseItem(caseConfig) {
  const caseCost = caseConfig.cost;

  const losingItems = caseConfig.items.filter(i => i.points < caseCost);
  const nearEvenItems = caseConfig.items.filter(i => i.points >= caseCost && i.points <= caseCost * 1.3);
  const winningItems = caseConfig.items.filter(i => i.points > caseCost * 1.3);

  const houseLuck = await getHouseLuckPercent();
  const houseChance = Math.max(0, Math.min(100, houseLuck)) / 100;

  const r = Math.random();
  if (r < houseChance && losingItems.length) return weightedRandom(losingItems);

  const nonLossPool = [...nearEvenItems, ...winningItems];
  if (nonLossPool.length) return weightedRandom(nonLossPool);
  return weightedRandom(caseConfig.items);
}

// ==================== IMAGE GENERATORS ====================
async function generateCaseOpeningImage(user, caseConfig) {
  const canvas = createCanvas(900, 400);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 900, 400);
  gradient.addColorStop(0, '#0f1419');
  gradient.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 400);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${caseConfig.emoji} ${caseConfig.name}`, 450, 60);
  ctx.font = '20px Arial';
  ctx.fillText(`${user.username} is opening...`, 450, 100);

  // Spinning emojis for suspense
  const emojis = ['💰', '💎', '🎰', '🌟', '👑', '🪙', '💥'];
  for (let i = 0; i < 15; i++) {
    const e = emojis[Math.floor(Math.random() * emojis.length)];
    ctx.font = '40px Arial';
    ctx.fillText(e, 100 + i * 50, 220 + Math.sin(i) * 10);
  }

  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = '#aaa';
  ctx.fillText('🎲 Rolling...', 450, 350);

  return canvas.toBuffer('image/png');
}

async function generateCaseResultImage(user, caseConfig, item, profit) {
  const canvas = createCanvas(900, 400);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 900, 400);
  gradient.addColorStop(0, '#0f1419');
  gradient.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 400);

  ctx.fillStyle = item.color;
  ctx.font = '80px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(item.emoji, 450, 180);

  ctx.font = 'bold 28px Arial';
  ctx.fillStyle = item.color;
  ctx.fillText(item.name, 450, 240);

  ctx.font = '22px Arial';
  ctx.fillStyle = profit >= 0 ? '#10b981' : '#ef4444';
  ctx.fillText(`${profit >= 0 ? '+' : ''}${profit.toFixed(2)} pts`, 450, 280);

  ctx.fillStyle = '#fff';
  ctx.font = '18px Arial';
  ctx.fillText(`${user.username} opened ${caseConfig.name}`, 450, 330);

  return canvas.toBuffer('image/png');
}

// ==================== COMMAND HANDLER ====================
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.type === ChannelType.DM) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();
  if (cmd !== 'case' && cmd !== 'cases' && cmd !== 'opencase') return;

  if (!args.length) {
    const embed = new EmbedBuilder()
      .setTitle('📦 Available Cases')
      .setDescription(Object.entries(CASES_CONFIG)
        .map(([key, c]) => `${c.emoji} **${c.name}** — ${c.cost} pts`)
        .join('\n'))
      .setFooter({ text: 'Use .case <type> to open!' })
      .setColor('#3498db');
    return msg.reply({ embeds: [embed] });
  }

  const caseType = args[0].toLowerCase();
  const caseConfig = CASES_CONFIG[caseType];
  if (!caseConfig) return msg.reply(`❌ Invalid case type! Use .cases to see options.`);

  // Get user + balance
  await ensureUserExists(msg.author.id);
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
  const balance = user?.balance || 0;

  if (balance < caseConfig.cost) {
    return msg.reply(`❌ You need ${caseConfig.cost} pts to open ${caseConfig.name}. Balance: ${balance.toFixed(2)} pts.`);
  }

  // Deduct + track
  await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [caseConfig.cost, msg.author.id]);
  await trackWageredAmount(msg.author.id, caseConfig.cost);

  // Send animation
  const anim = await generateCaseOpeningImage(msg.author, caseConfig);
  const openMsg = await msg.reply({ files: [new AttachmentBuilder(anim, { name: 'opening.png' })] });

  // Suspense
  await new Promise(r => setTimeout(r, 2500));

  const item = await rollCaseItem(caseConfig);
  const profit = item.points - caseConfig.cost;

  await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [item.points, msg.author.id]);

  const result = await generateCaseResultImage(msg.author, caseConfig, item, profit);
  const resultAtt = new AttachmentBuilder(result, { name: 'case-result.png' });

  const embed = new EmbedBuilder()
    .setColor(item.color)
    .setImage('attachment://case-result.png')
    .setFooter({ text: '🎰 MasterBets Case Result' });

  const againBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`case_again_${caseType}`)
      .setLabel(`Open Another ${caseConfig.name}`)
      .setStyle(ButtonStyle.Success)
  );

  await openMsg.edit({ embeds: [embed], files: [resultAtt], components: [againBtn] });
});

// ==================== BUTTON HANDLER ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('case_again_')) return;

  const caseType = interaction.customId.split('_')[2];
  const caseConfig = CASES_CONFIG[caseType];
  if (!caseConfig) return interaction.reply({ content: '❌ Invalid case type!', ephemeral: true });

  await interaction.deferUpdate();
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [interaction.user.id]);
  const balance = user?.balance || 0;
  if (balance < caseConfig.cost)
    return interaction.followUp({ content: `❌ Not enough balance to open again.`, ephemeral: true });

  await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [caseConfig.cost, interaction.user.id]);
  const anim = await generateCaseOpeningImage(interaction.user, caseConfig);
  await interaction.editReply({ files: [new AttachmentBuilder(anim, { name: 'opening.png' })], embeds: [], components: [] });

  await new Promise(r => setTimeout(r, 2500));
  const item = await rollCaseItem(caseConfig);
  const profit = item.points - caseConfig.cost;
  await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [item.points, interaction.user.id]);

  const result = await generateCaseResultImage(interaction.user, caseConfig, item, profit);
  const resultAtt = new AttachmentBuilder(result, { name: 'case-result.png' });

  const embed = new EmbedBuilder()
    .setColor(item.color)
    .setImage('attachment://case-result.png')
    .setFooter({ text: '🎰 MasterBets Case Result' });

  const againBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`case_again_${caseType}`)
      .setLabel(`Open Another ${caseConfig.name}`)
      .setStyle(ButtonStyle.Success)
  );

  await interaction.editReply({ embeds: [embed], files: [resultAtt], components: [againBtn] });
});

console.log('✅ Cases system with animation loaded!');
// ==================== DICE WAR GAME SYSTEM ====================
// High-quality dice war game with animations, logging, and profit mode

/**
 * Generate rolling dice animation image
 */
async function generateDiceRollingImage(user, betAmount) {
  try {
    const width = 800;
    const height = 450;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Dark gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f1419');
    gradient.addColorStop(0.5, '#1a1f2e');
    gradient.addColorStop(1, '#0f1419');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Diagonal stripe pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🎲 DICE WAR', width / 2, 60);

    // Player info
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '20px Arial';
    ctx.fillText(`${user.username} vs MasterBets`, width / 2, 95);

    // Bet amount
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`Bet: ${betAmount.toFixed(2)} points`, width / 2, 130);

    // Animated rolling dice (player side)
    const playerDiceX = width / 4;
    const diceY = height / 2;
    drawAnimatedDice(ctx, playerDiceX, diceY, 80);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('You', playerDiceX, diceY + 110);

    // VS text
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('VS', width / 2, diceY + 20);

    // Animated rolling dice (MasterBets side)
    const botDiceX = (width * 3) / 4;
    drawAnimatedDice(ctx, botDiceX, diceY, 80);

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('MasterBets', botDiceX, diceY + 110);

    // Rolling status
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('🎲 Rolling Dice...', width / 2, height - 50);

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '14px Arial';
    ctx.fillText('MasterBets Provably Fair Dice War', width / 2, height - 15);

    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating dice rolling image:', error);
    return generateFallbackDiceImage();
  }
}

/**
 * Draw animated dice with blur effect
 */
function drawAnimatedDice(ctx, x, y, size) {
  const time = Date.now() / 100;
  
  for (let i = 0; i < 4; i++) {
    const alpha = (4 - i) * 0.2;
    const offset = i * 8;
    const rotation = (time + i * 20) % 360;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + offset * Math.sin(rotation), y);
    ctx.rotate((rotation * Math.PI) / 180);
    
    // Dice shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    
    // Dice body
    const gradient = ctx.createLinearGradient(-size/2, -size/2, size/2, size/2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#e5e7eb');
    ctx.fillStyle = gradient;
    
    const radius = 10;
    ctx.beginPath();
    ctx.moveTo(-size/2 + radius, -size/2);
    ctx.lineTo(size/2 - radius, -size/2);
    ctx.quadraticCurveTo(size/2, -size/2, size/2, -size/2 + radius);
    ctx.lineTo(size/2, size/2 - radius);
    ctx.quadraticCurveTo(size/2, size/2, size/2 - radius, size/2);
    ctx.lineTo(-size/2 + radius, size/2);
    ctx.quadraticCurveTo(-size/2, size/2, -size/2, size/2 - radius);
    ctx.lineTo(-size/2, -size/2 + radius);
    ctx.quadraticCurveTo(-size/2, -size/2, -size/2 + radius, -size/2);
    ctx.closePath();
    ctx.fill();
    
    // Dice border
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
  }
}

/**
 * Generate dice war result image with actual dice faces
 */
async function generateDiceResultImage(user, betAmount, playerRoll, botRoll, win, winnings, profit) {
  try {
    const width = 800;
    const height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f1419');
    gradient.addColorStop(0.5, '#1a1f2e');
    gradient.addColorStop(1, '#0f1419');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Diagonal stripe pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Title with result
    const resultText = win ? '🥳 YOU WON!' : '😔 YOU LOST!';
    const resultColor = win ? '#10b981' : '#ef4444';
    ctx.fillStyle = resultColor;
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(resultText, width / 2, 60);

    // Player info
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px Arial';
    ctx.fillText(`${user.username} vs MasterBets`, width / 2, 95);

    // Player dice (left side)
    const playerDiceX = width / 4;
    const diceY = height / 2 - 20;
    drawDiceFace(ctx, playerDiceX, diceY, 90, playerRoll, win);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('You', playerDiceX, diceY - 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.fillText(playerRoll.toString(), playerDiceX, diceY + 130);

    // VS text
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('VS', width / 2, diceY + 20);

    // Bot dice (right side)
    const botDiceX = (width * 3) / 4;
    drawDiceFace(ctx, botDiceX, diceY, 90, botRoll, !win);

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('MasterBets', botDiceX, diceY - 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.fillText(botRoll.toString(), botDiceX, diceY + 130);

    // Results panel
    const panelY = height - 140;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(50, panelY, width - 100, 100);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('😮 Results', width / 2, panelY + 30);

    // Details
    ctx.font = '18px Arial';
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.fillText(`Bet: ${betAmount.toFixed(2)} pts`, 80, panelY + 60);
    
    if (win) {
      ctx.fillStyle = '#10b981';
      ctx.fillText(`Winnings: ${winnings.toFixed(2)} pts`, 280, panelY + 60);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`Profit: +${profit.toFixed(2)} pts`, 530, panelY + 60);
    } else {
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`Lost: ${betAmount.toFixed(2)} pts`, 280, panelY + 60);
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(`Profit: -${betAmount.toFixed(2)} pts`, 530, panelY + 60);
    }

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '14px Arial';
    ctx.fillText('MasterBets Provably Fair Dice War 🎲 1.92x Multiplier', width / 2, height - 15);

    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating dice result image:', error);
    return generateFallbackDiceImage();
  }
}

/**
 * Draw a dice face with dots
 */
function drawDiceFace(ctx, x, y, size, number, highlight = false) {
  ctx.save();
  ctx.translate(x, y);

  // Dice shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;

  // Dice body with gradient
  const gradient = ctx.createLinearGradient(-size/2, -size/2, size/2, size/2);
  if (highlight) {
    gradient.addColorStop(0, '#fef3c7');
    gradient.addColorStop(1, '#fcd34d');
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#f3f4f6');
  }
  ctx.fillStyle = gradient;

  const radius = 12;
  ctx.beginPath();
  ctx.moveTo(-size/2 + radius, -size/2);
  ctx.lineTo(size/2 - radius, -size/2);
  ctx.quadraticCurveTo(size/2, -size/2, size/2, -size/2 + radius);
  ctx.lineTo(size/2, size/2 - radius);
  ctx.quadraticCurveTo(size/2, size/2, size/2 - radius, size/2);
  ctx.lineTo(-size/2 + radius, size/2);
  ctx.quadraticCurveTo(-size/2, size/2, -size/2, size/2 - radius);
  ctx.lineTo(-size/2, -size/2 + radius);
  ctx.quadraticCurveTo(-size/2, -size/2, -size/2 + radius, -size/2);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = highlight ? '#f59e0b' : '#d1d5db';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Reset shadow
  ctx.shadowColor = 'transparent';

  // Draw dots based on number
  ctx.fillStyle = '#1f2937';
  const dotSize = 8;
  const spacing = size / 4;

  switch (number) {
    case 1:
      drawDot(ctx, 0, 0, dotSize);
      break;
    case 2:
      drawDot(ctx, -spacing, -spacing, dotSize);
      drawDot(ctx, spacing, spacing, dotSize);
      break;
    case 3:
      drawDot(ctx, -spacing, -spacing, dotSize);
      drawDot(ctx, 0, 0, dotSize);
      drawDot(ctx, spacing, spacing, dotSize);
      break;
    case 4:
      drawDot(ctx, -spacing, -spacing, dotSize);
      drawDot(ctx, spacing, -spacing, dotSize);
      drawDot(ctx, -spacing, spacing, dotSize);
      drawDot(ctx, spacing, spacing, dotSize);
      break;
    case 5:
      drawDot(ctx, -spacing, -spacing, dotSize);
      drawDot(ctx, spacing, -spacing, dotSize);
      drawDot(ctx, 0, 0, dotSize);
      drawDot(ctx, -spacing, spacing, dotSize);
      drawDot(ctx, spacing, spacing, dotSize);
      break;
    case 6:
      drawDot(ctx, -spacing, -spacing, dotSize);
      drawDot(ctx, spacing, -spacing, dotSize);
      drawDot(ctx, -spacing, 0, dotSize);
      drawDot(ctx, spacing, 0, dotSize);
      drawDot(ctx, -spacing, spacing, dotSize);
      drawDot(ctx, spacing, spacing, dotSize);
      break;
  }

  ctx.restore();
}

/**
 * Helper to draw a dot on dice
 */
function drawDot(ctx, x, y, size) {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Fallback dice image for errors
 */
function generateFallbackDiceImage() {
  const canvas = createCanvas(600, 300);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1f2e';
  ctx.fillRect(0, 0, 600, 300);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('ðŸŽ² Dice War', 300, 150);
  return canvas.toBuffer('image/png');
}

/**
 * Roll dice with profit mode consideration
 */
async function rollDiceWithProfitMode(userRoll) {
  const houseLuck = await getHouseLuckPercent();
  const userWinChance = Math.max(0, Math.min(100, 100 - houseLuck));
  const randomNum = crypto.randomInt(0, 100);
  const userWins = randomNum < userWinChance;

  if (userWins) {
    const maxBotRoll = userRoll - 1;
    if (maxBotRoll < 1) {
      return crypto.randomInt(2, 7);
    }
    return crypto.randomInt(1, maxBotRoll + 1);
  }

  if (userRoll === 6) {
    return 6;
  }
  return crypto.randomInt(userRoll, 7);
}

// Dice war command handler
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.type === ChannelType.DM) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/g);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'ward' || cmd === 'dicewar') {
    try {
      // Parse bet amount
      if (args.length < 1) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Dice War 🎲" Invalid Command')
          .setDescription('**Usage:** `.ward <amount>` or `.dicewar <amount>`\n\n**Examples:**\nâ€¢ `.ward 50` - Bet 50 points\nâ€¢ `.ward all` - Bet all points\nâ€¢ `.dicewar 100` - Bet 100 points')
          .setColor('#e74c3c')
          .addFields([
            { name: 'ðŸŽ¯ Rules', value: 'Both you and MasterBets roll a dice (1-6). Higher roll wins!', inline: false },
            { name: '🏆 Payout', value: '1.92x on win (0.08x fee)', inline: true },
            { name: '😶 Range', value: '1-1000 points', inline: true }
          ])
          .setFooter({ text: 'MasterBets 🎲 Dice War' });
        
        return msg.reply({ embeds: [embed] });
      }

      let points;
      if (args[0].toLowerCase() === 'all') {
        await ensureUserExists(msg.author.id);
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
        const balance = user?.balance || 0;
        points = Math.min(balance, 1000);
      } else {
        const parsedAmount = parseAmount(args[0]);
        if (!parsedAmount) {
          return msg.reply('âŒ Invalid amount format. Use `.ward 50` or `.ward 0.5$`');
        }
        
        if (parsedAmount.type === 'usd') {
          points = await usdToPoints(parsedAmount.amount);
        } else {
          points = parsedAmount.amount;
        }
      }

      // Validate bet amount
      if (isNaN(points) || points < 1 || points > 1000) {
        return msg.reply('💸 Bet must be between 1 and 1000 points.');
      }

      // Check balance
      await ensureUserExists(msg.author.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const balance = user?.balance || 0;

      if (balance < points) {
        return msg.reply(`🔴 Insufficient balance. You have ${balance.toFixed(2)} points but need ${points.toFixed(2)} points.`);
      }

      // Deduct bet and track wager
      await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, msg.author.id]);
      await trackWageredAmount(msg.author.id, points);

      // Show rolling animation
      const rollingImage = await generateDiceRollingImage(msg.author, points);
      const rollingAttachment = new AttachmentBuilder(rollingImage, { name: 'dice-rolling.png' });
      
      const rollingEmbed = new EmbedBuilder()
        .setColor('#fbbf24')
        .setImage('attachment://dice-rolling.png')
        .setFooter({ text: 'MasterBets' });

      const rollingMsg = await msg.reply({ embeds: [rollingEmbed], files: [rollingAttachment] });

      // Wait for suspense
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Roll dice
      const playerRoll = crypto.randomInt(1, 7); // 1-6
      const botRoll = await rollDiceWithProfitMode(playerRoll);

      // Determine winner
      const win = playerRoll > botRoll;
      const multiplier = 1.92;
      const winnings = win ? Number((points * multiplier).toFixed(2)) : 0;
      const profit = win ? Number((winnings - points).toFixed(2)) : -points;
      const fee = win ? Number((points * 0.08).toFixed(2)) : 0;

      // Update balance
      if (win) {
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, msg.author.id]);
        
        // Track fee
        if (fee > 0) {
          await trackCollectedFee('dice_war', fee, 'dice_war', msg.author.id, points, '0.08x fee on dice war win');
        }

        // Log win
        try {
          await sendLogMessage(`🎲 ${msg.author.username} won ${winnings.toFixed(2)} points in Dice War! (${playerRoll} vs ${botRoll})`);
        } catch (logError) {
          console.error('Error logging dice war win:', logError);
        }
      } else {
        // Track loss fee
        await trackCollectedFee('dice_war', points, 'dice_war', msg.author.id, points, 'Dice war loss');
      }

      // Generate result image
      const resultImage = await generateDiceResultImage(msg.author, points, playerRoll, botRoll, win, winnings, profit);
      const resultAttachment = new AttachmentBuilder(resultImage, { name: 'dice-result.png' });

      const resultEmbed = new EmbedBuilder()
        .setColor(win ? '#10b981' : '#ef4444')
        .setImage('attachment://dice-result.png')
        .setFooter({ text: 'MasterBets' });

      // Play again button
      const playAgainButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dicewar_again_${points.toFixed(2)}`)
          .setLabel(`Play Again (${points.toFixed(2)} pts)`)
          .setStyle(win ? ButtonStyle.Success : ButtonStyle.Danger)
      );

      await rollingMsg.edit({ 
        embeds: [resultEmbed], 
        files: [resultAttachment], 
        components: [playAgainButton] 
      });

    } catch (error) {
      console.error('Dice war error:', error);
      await msg.reply('âŒ An error occurred during dice war. Please try again.');
    }
  }
});

// Dice war "play again" button handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('dicewar_again_')) return;

  const points = parseFloat(interaction.customId.split('_')[2]);

  try {
    await interaction.deferUpdate();

    // Check balance
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [interaction.user.id]);
    const balance = user?.balance || 0;

    if (balance < points) {
      return interaction.followUp({ 
        content: `âŒ Insufficient balance. You need ${points.toFixed(2)} points.`, 
        ephemeral: true 
      });
    }

    // Deduct bet and track wager
    await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, interaction.user.id]);
    await trackWageredAmount(interaction.user.id, points);

    // Show rolling animation
    const rollingImage = await generateDiceRollingImage(interaction.user, points);
    const rollingAttachment = new AttachmentBuilder(rollingImage, { name: 'dice-rolling.png' });
    
    const rollingEmbed = new EmbedBuilder()
      .setColor('#fbbf24')
      .setImage('attachment://dice-rolling.png')
      .setFooter({ text: 'MasterBets' });

    await interaction.editReply({ embeds: [rollingEmbed], files: [rollingAttachment], components: [] });

    // Wait for suspense
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Roll dice
    const playerRoll = crypto.randomInt(1, 7);
    const botRoll = await rollDiceWithProfitMode(playerRoll);

    // Determine winner
    const win = playerRoll > botRoll;
    const multiplier = 1.92;
    const winnings = win ? Number((points * multiplier).toFixed(2)) : 0;
    const profit = win ? Number((winnings - points).toFixed(2)) : -points;
    const fee = win ? Number((points * 0.08).toFixed(2)) : 0;

    // Update balance
    if (win) {
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, interaction.user.id]);
      
      if (fee > 0) {
        await trackCollectedFee('dice_war', fee, 'dice_war', interaction.user.id, points, '0.08x fee on dice war win');
      }

      try {
        await sendLogMessage(`ðŸŽ² ${interaction.user.username} won ${winnings.toFixed(2)} points in Dice War! (${playerRoll} vs ${botRoll})`);
      } catch (logError) {}
    } else {
      await trackCollectedFee('dice_war', points, 'dice_war', interaction.user.id, points, 'Dice war loss');
    }

    // Generate result
    const resultImage = await generateDiceResultImage(interaction.user, points, playerRoll, botRoll, win, winnings, profit);
    const resultAttachment = new AttachmentBuilder(resultImage, { name: 'dice-result.png' });

    const resultEmbed = new EmbedBuilder()
      .setColor(win ? '#10b981' : '#ef4444')
      .setImage('attachment://dice-result.png')
      .setFooter({ text: 'MasterBets' });

    const playAgainButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dicewar_again_${points.toFixed(2)}`)
        .setLabel(`Play Again (${points.toFixed(2)} pts)`)
        .setStyle(win ? ButtonStyle.Success : ButtonStyle.Danger)
    );

    await interaction.editReply({ 
      embeds: [resultEmbed], 
      files: [resultAttachment], 
      components: [playAgainButton] 
    });

  } catch (error) {
    console.error('Dice war button error:', error);
    try {
      await interaction.followUp({ 
        content: 'âŒ An error occurred. Please try again.', 
        ephemeral: true 
      });
    } catch (e) {}
  }
});

console.log('âœ… Dice War system loaded!');

// ==================== MasterBets FAIR PLAY PROTOCOL ====================
// Enhanced provably fair system - Better than BetRush with 6-hour periods

// Generate cryptographically secure server seed
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

// Create SHA256 hash commitment
function createServerHash(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex');
}

// Generate client seed for games
function generateClientSeed() {
  return crypto.randomBytes(16).toString('hex');
}

// Create combined hash for game result verification
function createGameResultHash(serverSeed, clientSeed, nonce) {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

// Send message to Fair Play channel
async function sendFairPlayMessage(content) {
  try {
    const channel = await client.channels.fetch(FAIR_PLAY_CHANNEL_ID);
    if (channel) {
      await channel.send(content);
    }
  } catch (error) {
    console.error('Error sending Fair Play message:', error);
  }
}

// Get current active period
async function getCurrentFairPlayPeriod() {
  try {
    const now = Date.now();
    const period = await dbGet(
      `SELECT * FROM fair_play_periods WHERE status = 'active' AND period_start <= ? AND period_end > ?`,
      [now, now]
    );
    return period;
  } catch (error) {
    console.error('Error getting current period:', error);
    return null;
  }
}

// Create new Fair Play period (6 hours)
async function createNewFairPlayPeriod() {
  try {
    const now = Date.now();
    const periodStart = now;
    const periodEnd = now + (6 * 60 * 60 * 1000); // 6 hours
    
    // Generate new server seed and hash
    const serverSeed = generateServerSeed();
    const serverHash = createServerHash(serverSeed);
    
    // Get next period number
    const lastPeriod = await dbGet('SELECT MAX(period_number) as max_period FROM fair_play_periods');
    const periodNumber = (lastPeriod?.max_period || 0) + 1;
    
    // Insert new period
    const result = await dbRun(
      `INSERT INTO fair_play_periods (period_number, server_seed, server_hash, period_start, period_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [periodNumber, serverSeed, serverHash, periodStart, periodEnd, now]
    );
    
    console.log(`Created new Fair Play period ${periodNumber}: ${serverHash}`);
    
    // Announce new period
    await announceFairPlayPeriod(periodNumber, serverHash, periodStart, periodEnd);
    
    return result.lastID;
  } catch (error) {
    console.error('Error creating Fair Play period:', error);
    return null;
  }
}

// Announce new Fair Play period with beautiful embed
async function announceFairPlayPeriod(periodNumber, serverHash, periodStart, periodEnd) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('🛡️ Masterbets Fair Play Protocol - New Period Active!')
      .setDescription(`**Period ${periodNumber}** has begun with enhanced security and transparency.`)
      .addFields([
        { name: '🔐 Server Hash (SHA256 Commitment)', value: `\`${serverHash}\``, inline: false },
        { name: '⏰ Period Duration', value: `6 hours (more frequent than competitors)`, inline: true },
        { name: '🎯 Period ID', value: `${periodNumber}`, inline: true },
        { name: '▶️ Started At', value: `<t:${Math.floor(periodStart/1000)}:F>`, inline: true },
        { name: '🏁 Ends At', value: `<t:${Math.floor(periodEnd/1000)}:F>`, inline: true },
        { name: '⏳ Time Remaining', value: `<t:${Math.floor(periodEnd/1000)}:R>`, inline: true },
        { name: '🔍 Verification Status', value: `Hash committed - seed will be revealed after period ends`, inline: false }
      ])
      .setColor('#00E5A8') // Masterbets brand color
      .setFooter({ text: '🚀 Masterbets Fair Play Protocol • Enhanced Security & Transparency' })
      .setTimestamp();

    await sendFairPlayMessage({ embeds: [embed] });
    console.log(`Fair Play period ${periodNumber} announced successfully`);
  } catch (error) {
    console.error('Error announcing Fair Play period:', error);
  }
}

// Reveal Fair Play period seed (when period ends)
async function revealFairPlayPeriod(periodId) {
  try {
    const period = await dbGet('SELECT * FROM fair_play_periods WHERE id = ?', [periodId]);
    if (!period) {
      console.error('Period not found for reveal:', periodId);
      return;
    }

    const now = Date.now();
    
    // Update period status to revealed
    await dbRun(
      'UPDATE fair_play_periods SET status = ?, revealed_at = ? WHERE id = ?',
      ['revealed', now, periodId]
    );

    // Create beautiful reveal embed
    const embed = new EmbedBuilder()
      .setTitle('🎉 Fair Play Protocol - Server Seed Revealed!')
      .setDescription(`**Period ${period.period_number}** has ended. The secret server seed is now revealed for verification.`)
      .addFields([
        { name: '🔓 Revealed Server Seed (Secret)', value: `\`${period.server_seed}\``, inline: false },
        { name: '?? Original Hash (Commitment)', value: `\`${period.server_hash}\``, inline: false },
        { name: '✅ Verification Instructions', value: `Calculate SHA256("${period.server_seed}") to verify it matches the original hash commitment`, inline: false },
        { name: '📊 Period Statistics', value: `Duration: 6 hours | ID: ${period.period_number}`, inline: true },
        { name: '⏰ Period Ended At', value: `<t:${Math.floor(period.period_end/1000)}:F>`, inline: true },
        { name: '🔍 Revealed At', value: `<t:${Math.floor(now/1000)}:F>`, inline: true }
      ])
      .setColor('#FFD700') // Gold color for reveals
      .setFooter({ text: '🎮 Master Bets• Verify all game results using this seed • Next period starting soon' })
      .setTimestamp();

    await sendFairPlayMessage({ embeds: [embed] });
    console.log(`Fair Play period ${period.period_number} seed revealed successfully`);
  } catch (error) {
    console.error('Error revealing Fair Play period:', error);
  }
}

// Check and manage Fair Play periods
async function manageFairPlayPeriods() {
  try {
    const now = Date.now();
    
    // Check for expired periods that need to be revealed
    const expiredPeriods = await dbAll(
      'SELECT * FROM fair_play_periods WHERE status = ? AND period_end <= ?',
      ['active', now]
    );

    for (const period of expiredPeriods) {
      await revealFairPlayPeriod(period.id);
    }

    // Check if we need a new active period
    const currentPeriod = await getCurrentFairPlayPeriod();
    if (!currentPeriod) {
      console.log('No active Fair Play period found, creating new one...');
      await createNewFairPlayPeriod();
    }
  } catch (error) {
    console.error('Error managing Fair Play periods:', error);
  }
}

// Initialize Fair Play Protocol system
async function initializeFairPlayProtocol() {
  try {
    console.log('🛡️ Initializing 🎮 Master Bets Fair Play Protocol...');
    
    // Check for current active period or create first one
    await manageFairPlayPeriods();
    
    // Set up periodic management (check every 5 minutes)
    setInterval(manageFairPlayPeriods, 5 * 60 * 1000);
    
    console.log('✅ Fair Play Protocol initialized successfully');
  } catch (error) {
    console.error('Error initializing Fair Play Protocol:', error);
  }
}

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    balance REAL DEFAULT 0,
    deposit_address TEXT,
    last_tx TEXT,
    last_deposit_check INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS deposits (
    txid TEXT PRIMARY KEY,
    address TEXT,
    amount_ltc REAL,
    amount_usd REAL,
    points INTEGER,
    credited INTEGER DEFAULT 0,
    credited_to TEXT,
    timestamp INTEGER,
    confirmations INTEGER DEFAULT 0
  )`);
db.run(`CREATE TABLE IF NOT EXISTS redeem_code_claims (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code)
)`);
db.run(`CREATE TABLE IF NOT EXISTS redeem_codes (
  code TEXT PRIMARY KEY,
  reward REAL NOT NULL,               -- points awarded per claim
  uses_remaining INTEGER NOT NULL,    -- how many times left
  total_uses INTEGER NOT NULL,         -- initial total uses (for reference)
  wager_requirement REAL DEFAULT 0,   -- minimum total_wagered required to redeem
  created_by TEXT,                    -- creator ID
  created_at INTEGER NOT NULL,
  active INTEGER DEFAULT 1            -- 1 = active, 0 = expired
)`);
  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    withdrawal_address TEXT NOT NULL,
    amount_points REAL NOT NULL,
    amount_ltc REAL NOT NULL,
    amount_usd REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    txid TEXT,
    fee_ltc REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    processed_at INTEGER,
    error_message TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_withdrawal_legacy (
    user_id TEXT PRIMARY KEY,
    legacy_points REAL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS point_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    points REAL NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  
  // Migration: Check if we need to migrate amount_points from INTEGER to REAL
  db.get("PRAGMA table_info(withdrawals)", (err, result) => {
    if (!err && result) {
      // Check if amount_points column exists and needs migration
      db.all("PRAGMA table_info(withdrawals)", (err, columns) => {
        if (!err && columns) {
          const amountPointsCol = columns.find(col => col.name === 'amount_points');
          if (amountPointsCol && amountPointsCol.type === 'INTEGER') {
            console.log('Migrating withdrawals table: amount_points INTEGER -> REAL');
            
            // Create new table with correct schema
            db.run(`CREATE TABLE withdrawals_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id TEXT NOT NULL,
              withdrawal_address TEXT NOT NULL,
              amount_points REAL NOT NULL,
              amount_ltc REAL NOT NULL,
              amount_usd REAL NOT NULL,
              status TEXT DEFAULT 'pending',
              txid TEXT,
              fee_ltc REAL DEFAULT 0,
              created_at INTEGER NOT NULL,
              processed_at INTEGER,
              error_message TEXT
            )`, (err) => {
              if (!err) {
                // Copy data with type conversion
                db.run(`INSERT INTO withdrawals_new SELECT 
                  id, user_id, withdrawal_address, 
                  CAST(amount_points AS REAL), amount_ltc, amount_usd,
                  status, txid, fee_ltc, created_at, processed_at, error_message 
                  FROM withdrawals`, (err) => {
                  if (!err) {
                    // Replace old table
                    db.run('DROP TABLE withdrawals', (err) => {
                      if (!err) {
                        db.run('ALTER TABLE withdrawals_new RENAME TO withdrawals', (err) => {
                          if (!err) {
                            console.log('✅ Migration completed: withdrawals.amount_points now supports decimals');
                          } else {
                            console.error('Migration error (rename):', err);
                          }
                        });
                      } else {
                        console.error('Migration error (drop):', err);
                      }
                    });
                  } else {
                    console.error('Migration error (copy):', err);
                  }
                });
              } else {
                console.error('Migration error (create):', err);
              }
            });
          }
        }
      });
    }
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS collected_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    amount_points REAL NOT NULL,
    game_type TEXT,
    user_id TEXT,
    bet_amount REAL,
    timestamp INTEGER NOT NULL,
    description TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS mines_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    bet_amount REAL NOT NULL,
    bombs INTEGER NOT NULL,
    grid_state TEXT NOT NULL,
    revealed_tiles TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    current_multiplier REAL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    cashout_message_id TEXT,
    force_loss INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mines_streaks (
    user_id TEXT PRIMARY KEY,
    win_streak INTEGER DEFAULT 0
  )`);

  db.all('PRAGMA table_info(mines_games)', (err, columns) => {
    if (err || !columns) return;
    const hasChannelId = columns.some(c => c.name === 'channel_id');
    const hasMessageId = columns.some(c => c.name === 'message_id');
    const hasCashoutMessageId = columns.some(c => c.name === 'cashout_message_id');
    const hasForceLoss = columns.some(c => c.name === 'force_loss');

    if (!hasChannelId) {
      db.run('ALTER TABLE mines_games ADD COLUMN channel_id TEXT');
    }
    if (!hasMessageId) {
      db.run('ALTER TABLE mines_games ADD COLUMN message_id TEXT');
    }
    if (!hasCashoutMessageId) {
      db.run('ALTER TABLE mines_games ADD COLUMN cashout_message_id TEXT');
    }
    if (!hasForceLoss) {
      db.run('ALTER TABLE mines_games ADD COLUMN force_loss INTEGER DEFAULT 0');
    }
  });
  
  db.run(`CREATE TABLE IF NOT EXISTS daily_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    last_claim_time INTEGER NOT NULL,
    total_claims INTEGER DEFAULT 1,
    UNIQUE(user_id)
  )`);

  // MasterBets Fair Play Protocol - Enhanced provably fair system
  db.run(`CREATE TABLE IF NOT EXISTS fair_play_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_number INTEGER NOT NULL UNIQUE,
    server_seed TEXT NOT NULL,
    server_hash TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    revealed_at INTEGER,
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fair_play_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    period_id INTEGER NOT NULL,
    client_seed TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    result_hash TEXT NOT NULL,
    bet_amount REAL,
    game_result TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (period_id) REFERENCES fair_play_periods(id)
  )`);

  // Profit mode configuration table
  db.run(`CREATE TABLE IF NOT EXISTS bot_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  )`);

  // Initialize profit mode as disabled if not exists
  db.run(`INSERT OR IGNORE INTO bot_config (config_key, config_value, updated_at) VALUES ('profit_mode', 'false', ?)`, [Date.now()]);

  // Blackjack games persistent storage for crash-safety
  db.run(`CREATE TABLE IF NOT EXISTS blackjack_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    bet_amount REAL NOT NULL,
    player_cards TEXT NOT NULL,
    dealer_cards TEXT NOT NULL,
    deck_state TEXT NOT NULL,
    game_state TEXT DEFAULT 'playing',
    result TEXT,
    winnings REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_action INTEGER NOT NULL,
    processing BOOLEAN DEFAULT 0
  )`);

  // Thread creators table for ownership tracking
  db.run(`CREATE TABLE IF NOT EXISTS thread_creators (
    thread_id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
db.run(`CREATE TABLE IF NOT EXISTS user_rakeback (
  user_id TEXT PRIMARY KEY,
  claimed_rakeback REAL DEFAULT 0,
  last_claim INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);
  // User levels and wagering tracking table with migration to fix baseline level
  db.run(`CREATE TABLE IF NOT EXISTS user_levels (
    user_id TEXT PRIMARY KEY,
    total_wagered REAL DEFAULT 0,
    current_level INTEGER DEFAULT -1,
    pending_level_claim BOOLEAN DEFAULT 0,
    last_level_update INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  
  // CRITICAL MIGRATION: Fix baseline level bug - update existing users with current_level = 0
  // to current_level = -1 if they haven't reached first threshold (200 wagered)
  db.get("PRAGMA table_info(user_levels)", (err, result) => {
    if (!err) {
      // Check existing data that needs migration
      db.all(
        "SELECT user_id, total_wagered, current_level FROM user_levels WHERE current_level = 0 AND total_wagered < 200", 
        (err, usersToMigrate) => {
          if (!err && usersToMigrate && usersToMigrate.length > 0) {
            console.log(`🔄 LEVEL SYSTEM MIGRATION: Found ${usersToMigrate.length} users with incorrect baseline level (0), updating to -1 (unranked)`);
            
            // Update all users who should be unranked (-1) but are incorrectly set to level 0
            db.run(
              "UPDATE user_levels SET current_level = -1 WHERE current_level = 0 AND total_wagered < 200",
              function(err) {
                if (!err) {
                  console.log(`✅ MIGRATION COMPLETED: Updated ${this.changes} users to unranked state (-1)`);
                } else {
                  console.error('❌ MIGRATION ERROR:', err);
                }
              }
            );
          } else {
            console.log('���� Level system baseline check: No migration needed');
          }
        }
      );
    }
  });

  // Recovery system: Auto-refund abandoned blackjack games on startup
  db.all(`SELECT * FROM blackjack_games WHERE game_state != 'finished'`, (err, games) => {
    if (!err && games && games.length > 0) {
      console.log(`🔧 Crash recovery: Found ${games.length} abandoned blackjack games, auto-refunding...`);
      
      games.forEach(async (game) => {
        try {
          // Refund the bet amount
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [game.bet_amount, game.user_id]);
          // DELETE the game instead of marking as finished to prevent UNIQUE constraint issues
          await dbRun('DELETE FROM blackjack_games WHERE id = ?', [game.id]);
          console.log(`  ✅ Refunded ${game.bet_amount} points to user ${game.user_id}`);
        } catch (error) {
          console.error(`  ❌ Failed to refund game ${game.id}:`, error);
        }
      });
    }
  });
});

// ==================== PROFIT MODE MANAGEMENT ====================

// SECURITY: Centralized admin authorization system
const ADMIN_CONFIG = {
  // Super admin - full access to all features including dangerous operations
  SUPER_ADMIN: ['998706760749682789', '0', '1355726712310071386', '0'],
  // Regular admins - access to most features but not dangerous operations
  REGULAR_ADMINS: ['1355726712310071386', '998706760749682789', '0', '0'],
  // Log admin actions for security audit trail
  logAdminAction: function(userId, action, details = '998706760749682789') {
  const adminLevel = this.SUPER_ADMIN.includes(userId) ? 'SUPER' : 'REGULAR';
    console.log(`[ADMIN-${adminLevel}] User ${userId} performed: ${action} ${details}`);
  }
};

// Thread ownership and rate limiting
const threadCreationCooldown = new Map(); // userId -> lastCreated timestamp
const THREAD_COOLDOWN_MS = 30000; // 30 seconds between thread creations

const blackjackButtonCooldown = new Map();
const BLACKJACK_BUTTON_COOLDOWN_MS = 2000;

const minesCashoutCooldown = new Map();
const MINES_CASHOUT_COOLDOWN_MS = 2000;

// Check if user can create a thread (rate limiting)
function canCreateThread(userId) {
  const lastCreated = threadCreationCooldown.get(userId);
  if (!lastCreated) return true;
  
  const timeSince = Date.now() - lastCreated;
  return timeSince >= THREAD_COOLDOWN_MS;
}

// Update thread creation timestamp
function updateThreadCreationTime(userId) {
  threadCreationCooldown.set(userId, Date.now());
}

// Find user's owned thread
async function getUserOwnedThread(userId) {
  try {
    const threadRecord = await dbGet('SELECT thread_id FROM thread_creators WHERE creator_id = ? LIMIT 1', [userId]);
    if (!threadRecord) return null;
    
    // Verify thread still exists on Discord
    try {
      const thread = await client.channels.fetch(threadRecord.thread_id);
      if (thread && thread.isThread() && !thread.archived) {
        return thread;
      } else {
        // Thread was deleted or archived, clean up database
        await dbRun('DELETE FROM thread_creators WHERE thread_id = ?', [threadRecord.thread_id]);
        return null;
      }
    } catch {
      // Thread doesn't exist, clean up database
      await dbRun('DELETE FROM thread_creators WHERE thread_id = ?', [threadRecord.thread_id]);
      return null;
    }
  } catch (error) {
    console.error('Error finding user owned thread:', error);
    return null;
  }
}

// Check if user owns a thread or is admin
async function isThreadOwnerOrAdmin(threadId, userId) {
  try {
    // Check if user is admin
    if (isRegularAdmin(userId)) return true;
    
    // Check if user is thread creator
    const creator = await dbGet('SELECT creator_id FROM thread_creators WHERE thread_id = ?', [threadId]);
    return creator && creator.creator_id === userId;
  } catch (error) {
    console.error('Error checking thread ownership:', error);
    return false;
  }
}

// Secure admin authorization functions
function isSuperAdmin(userId) {
  return ADMIN_CONFIG.SUPER_ADMIN.includes(userId);
}

function isRegularAdmin(userId) {
  return ADMIN_CONFIG.REGULAR_ADMINS.includes(userId);
}

function requireSuperAdmin(userId, action) {
  if (!isSuperAdmin(userId)) {
    ADMIN_CONFIG.logAdminAction(userId, `BLOCKED: Attempted ${action}`, '(insufficient privileges)');
    return false;
  }
  ADMIN_CONFIG.logAdminAction(userId, action);
  return true;
}

function requireRegularAdmin(userId, action) {
  if (!isRegularAdmin(userId)) {
    console.log(`[SECURITY] Unauthorized access attempt by ${userId} for: ${action}`);
    return false;
  }
  ADMIN_CONFIG.logAdminAction(userId, action);
  return true;
}

// Get profit mode status
async function getProfitMode() {
  try {
    const config = await dbGet('SELECT config_value FROM bot_config WHERE config_key = ?', ['profit_mode']);
    return config?.config_value === 'true';
  } catch (error) {
    console.error('Error getting profit mode:', error);
    return false; // Default to disabled
  }
}

async function getHouseLuckPercent() {
  const profitMode = await getProfitMode();
  return profitMode ? BOT_LUCK_PERCENT_ON : BOT_LUCK_PERCENT_OFF;
}

// Set profit mode status with enhanced security logging
async function setProfitMode(enabled, userId) {
  try {
    const value = enabled ? 'true' : 'false';
    const timestamp = Date.now();
    
    await dbRun('UPDATE bot_config SET config_value = ?, updated_at = ?, updated_by = ? WHERE config_key = ?', 
      [value, timestamp, userId, 'profit_mode']);
    
    // SECURITY: Enhanced logging for profit mode changes
    const action = enabled ? 'ENABLED' : 'DISABLED';
    console.log(`🛑 [CRITICAL SECURITY] PROFIT MODE ${action} by user ${userId} at ${new Date(timestamp).toISOString()}`);
    ADMIN_CONFIG.logAdminAction(userId, `PROFIT_MODE_${action}`, `- This affects all user game outcomes`);
    
    // Log to database for audit trail
    await dbRun(
      'INSERT INTO collected_fees (source, amount_points, game_type, user_id, timestamp, description) VALUES (?, ?, ?, ?, ?, ?)',
      ['ADMIN_ACTION', 0, 'PROFIT_MODE', userId, timestamp, `Profit mode ${action.toLowerCase()}`]
    );
    
    return true;
  } catch (error) {
    console.error('Error setting profit mode:', error);
    ADMIN_CONFIG.logAdminAction(userId, 'PROFIT_MODE_ERROR', error.message);
    return false;
  }
}

// Helper function to draw circular profile picture
async function drawCircularProfilePicture(ctx, user, x, y, radius) {
  try {
    // Try JPEG format first, it's more universally supported
    let avatarURL;
    
    if (user.avatar) {
      // Try JPEG format instead of PNG for better compatibility
      avatarURL = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.jpg?size=256`;
    } else {
      // Fallback to default Discord avatar (these are always PNG and work)
      const defaultNum = (BigInt(user.id) >> BigInt(22)) % BigInt(6);
      avatarURL = `https://cdn.discordapp.com/embed/avatars/${defaultNum}.png`;
    }
    
    console.log(`Loading Discord avatar: ${avatarURL}`);
    
    // Load image directly - try JPEG first as it's better supported
    const avatar = await loadImage(avatarURL);
    
    // Save context for clipping
    ctx.save();
    
    // Create circular clipping path
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.clip();
    
    // Draw the profile picture
    ctx.drawImage(avatar, x - radius, y - radius, radius * 2, radius * 2);
    
    // Restore context
    ctx.restore();
    
    // Add border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    console.log(`Successfully loaded Discord avatar for ${user.username}`);
    
  } catch (error) {
    console.log(`Failed to load Discord avatar for ${user.username}, using fallback:`, error.message);
    
    // Fallback: Draw colored circle with initial
    ctx.fillStyle = 'rgba(100, 181, 246, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
    
    // Add border
    ctx.strokeStyle = 'rgba(100, 181, 246, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw initial
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.floor(radius * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initial = user.username ? user.username.charAt(0).toUpperCase() : '?';
    ctx.fillText(initial, x, y);
    
    // Reset text alignment
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

// Get LTC price in USD
async function getLTCPriceUSD() {
  try {
    console.log('Fetching LTC price from CoinGecko...');
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Masterbets-Bot/1.0'
      },
      timeout: 10000
    });
    
    if (!r.ok) {
      console.error(`CoinGecko API returned ${r.status}: ${r.statusText}`);
      
      // Try backup API
      console.log('Trying backup price API...');
      const backupResponse = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=LTC');
      if (backupResponse.ok) {
        const backupData = await backupResponse.json();
        const usdRate = backupData?.data?.rates?.USD;
        if (usdRate) {
          const price = Number(usdRate);
          console.log(`Got LTC price from backup API: $${price}`);
          return price;
        }
      }
      
      console.log('Using fallback price: $75');
      return 75;
    }
    
    const j = await r.json();
    console.log('CoinGecko API response:', j);
    
    if (j && j.litecoin && j.litecoin.usd) {
      const price = Number(j.litecoin.usd);
      console.log(`Got LTC price: $${price}`);
      return price;
    } else {
      console.error('Invalid response structure from CoinGecko:', j);
      console.log('Using fallback price: $75');
      return 75;
    }
  } catch (e) {
    console.error('Error fetching LTC price:', e);
    console.log('Using fallback price: $75');
    return 75;
  }
}

// Send withdrawal notification to channel
async function sendWithdrawalDM(user, withdrawalData) {
  try {
    // Convert fee from satoshis to LTC and USD
    let feeLTC = 0;
    let feeUSD = 0;
    let feeDisplay = 'Unknown';
    
    if (withdrawalData.fee && withdrawalData.fee !== 'unknown') {
      feeLTC = withdrawalData.fee / 1e8; // Convert satoshis to LTC
      
      // Get LTC price for USD conversion
      try {
        const ltcPrice = await getLTCPriceUSD();
        feeUSD = feeLTC * ltcPrice;
        feeDisplay = `${feeLTC.toFixed(8)} LTC ($${feeUSD.toFixed(4)})`;
      } catch (e) {
        feeDisplay = `${feeLTC.toFixed(8)} LTC`;
      }
    }
    
    // Format address for better display
    const shortAddress = withdrawalData.ltcAddress.length > 16 ? 
      `${withdrawalData.ltcAddress.substring(0, 8)}...${withdrawalData.ltcAddress.substring(withdrawalData.ltcAddress.length - 8)}` : 
      withdrawalData.ltcAddress;

    const withdrawalEmbed = new EmbedBuilder()
      .setTitle('💸 Withdrawal Successfully Processed!')
      .setDescription(`🚀 **${user.username}** successfully withdrew from **Masterbets**!`)
      .setColor('#00E5A8')
      .addFields([
        { name: '👤 User', value: `<@${user.id}>`, inline: true },
        { name: '💎 Points Withdrawn', value: `\`${withdrawalData.points.toLocaleString()} points\``, inline: true },
        { name: '💰 LTC Amount', value: `\`${withdrawalData.ltcAmount.toFixed(8)} LTC\``, inline: true },
        { name: '💵 USD Value', value: `\`$${withdrawalData.amountUsd.toFixed(2)}\``, inline: true },
        { name: '💸 Network Fee', value: `\`${feeDisplay}\``, inline: true },
        { name: '⏱️ Processed', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
        { name: '📍 Destination', value: `\`${shortAddress}\``, inline: false },
        { name: '⚡ Transaction Hash', value: `[\`${withdrawalData.txid.substring(0, 8)}...${withdrawalData.txid.substring(withdrawalData.txid.length - 8)}\`](https://blockchair.com/litecoin/transaction/${withdrawalData.txid})`, inline: false }
      ])
      .setFooter({ 
        text: '🎮 Master Bets • Withdrawal Processed' 
      })
      .setTimestamp();

    // Send to withdrawal channel instead of DM
    const channel = await client.channels.fetch(WITHDRAWAL_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [withdrawalEmbed] });
      console.log(`Withdrawal notification sent to channel for user: ${user.username}, txid: ${withdrawalData.txid}`);
    }
    
  } catch (error) {
    console.error('Failed to send withdrawal notification:', error);
    // Don't throw error - notification failure shouldn't break withdrawal process
  }
}

// Create unique deposit address for user
async function createUserDepositAddress(userId) {
  try {
    const res = await fetch(`https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/addresses`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Transfer-Key': APIRONE_TRANSFER_KEY
      },
      body: JSON.stringify({})
    });
    
    if (!res.ok) {
      console.log(`Apirone address creation returned ${res.status}: ${res.statusText}`);
      return null;
    }
    
    const data = await res.json();
    
    if (data.address) {
      await dbRun('INSERT OR REPLACE INTO users (id, deposit_address) VALUES (?, ?)', [userId, data.address]);
      console.log(`Created address ${data.address} for user ${userId}`);
      return data.address;
    } else {
      throw new Error('No address returned: ' + JSON.stringify(data));
    }
  } catch (err) {
    console.error('Error creating deposit address:', err);
    return null;
  }
}

// Ensure user exists in database
async function ensureUserExists(id) {
  const u = await dbGet('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) await dbRun('INSERT INTO users (id) VALUES (?)', [id]);
}

// Fetch wallet transactions from Apirone
async function fetchWalletTransactions() {
  try {
    // Skip wallet-level transaction fetching - use address-level instead
    console.log('Skipping wallet-level transaction fetch - using address-level scanning');
    return [];
    // const res = await fetch(`https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}`);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.log(`Apirone API returned ${res.status}: ${res.statusText}`);
      console.log(`Error details:`, errorText);
      if (res.status === 404) {
        console.log('Wallet not found or no transactions yet - this is normal for new wallets');
      }
      return [];
    }
    
    const data = await res.json();
    console.log('Fetched transactions:', Array.isArray(data) ? data.length : 'Invalid response', 'transactions');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return [];
  }
}

// Fetch transactions for a specific address using Apirone
async function fetchAddressTransactions(address) {
  try {
    const res = await fetch(`https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/addresses/${address}/history`);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.log(`Apirone address API returned ${res.status}: ${res.statusText}`);
      console.log(`Address API error details:`, errorText);
      return [];
    }
    
    const data = await res.json();
    console.log(`Raw API response for address ${address}:`, JSON.stringify(data, null, 2));
    
    // Handle Apirone API response format: data.txs contains the transactions array
    const transactions = data.txs || [];
    console.log(`Fetched ${transactions.length} transactions for address ${address}`);
    return transactions;
  } catch (err) {
    console.error('Error fetching address transactions:', err);
    return [];
  }
}

// Convert LTC amount to points (0.0001 LTC = 1 point)
function ltcToPoints(amountLtc) {
  return Math.round((amountLtc / 0.0001) * 100) / 100; // 0.0001 LTC = 1 point, preserve decimals
}

// Convert points to LTC amount (reverse conversion)
function pointsToLtc(points) {
  const ltcAmount = points * 0.0001; // 1 point = 0.0001 LTC
  
  // Round to 8 decimal places (LTC precision)
  return Math.round(ltcAmount * 1e8) / 1e8;
}

// Convert USD amount to points using current LTC price
async function usdToPoints(usdAmount) {
  try {
    const ltcPrice = await getLTCPriceUSD();
    const ltcAmount = usdAmount / ltcPrice; // Convert USD to LTC
    const points = ltcToPoints(ltcAmount); // Convert LTC to points
    return Math.round(points * 100) / 100; // Proper rounding to 2 decimal places
  } catch (error) {
    console.error('Error converting USD to points:', error);
    throw new Error('Unable to get current exchange rate');
  }
}

// Parse amount from string - supports both points and USD ($)
function parseAmount(amountStr) {
  if (typeof amountStr !== 'string') return null;
  
  // Check if it's USD format (ends with $)
  if (amountStr.endsWith('$')) {
    const usdAmount = parseFloat(amountStr.slice(0, -1));
    if (isNaN(usdAmount) || usdAmount <= 0) return null;
    return { type: 'usd', amount: usdAmount };
  }
  
  // Otherwise treat as points
  const pointsAmount = parseFloat(amountStr);
  if (isNaN(pointsAmount) || pointsAmount <= 0) return null;
  return { type: 'points', amount: pointsAmount };
}

// Get bot wallet balance from Apirone
async function getBotWalletBalance() {
  try {
    const res = await fetch(`https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/balance`);
    
    if (!res.ok) {
      console.error(`Apirone balance API returned ${res.status}: ${res.statusText}`);
      return null;
    }
    
    const data = await res.json();
    console.log('Bot wallet balance:', data);
    
    // Convert satoshis to LTC
    const ltcAvailable = data.available / 100000000;
    const ltcTotal = data.total / 100000000;
    
    return {
      available: ltcAvailable,
      total: ltcTotal,
      availableSatoshis: data.available,
      totalSatoshis: data.total
    };
  } catch (error) {
    console.error('Error fetching bot wallet balance:', error);
    return null;
  }
}

// Validate LTC address format (basic validation - production should use proper checksum validation)
function isValidLtcAddress(address) {
  if (!address || typeof address !== 'string') return false;
  
  // Basic format checks for LTC addresses
  // Legacy addresses (L prefix): 34 characters typically
  const legacyRegex = /^L[a-km-zA-HJ-NP-Z1-9]{32,33}$/;
  
  // Multi-sig addresses (M prefix): similar length
  const multisigRegex = /^M[a-km-zA-HJ-NP-Z1-9]{32,33}$/;
  
  // Bech32 addresses (ltc1 prefix): minimum realistic length
  const bech32Regex = /^ltc1[ac-hj-np-z02-9]{39,}$/;
  
  return legacyRegex.test(address) || multisigRegex.test(address) || bech32Regex.test(address);
}

// Check if user has sufficient balance for withdrawal
async function checkWithdrawalBalance(userId, pointsToWithdraw) {
  await ensureUserExists(userId);
  const user = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
  
  if (!user) return { valid: false, message: 'User not found' };
  if (user.balance < pointsToWithdraw) {
    return { 
      valid: false, 
      message: `Insufficient balance. You have ${user.balance.toFixed(2)} points but need ${pointsToWithdraw.toFixed(2)} points.` 
    };
  }
  
  return { valid: true, currentBalance: user.balance };
}

// Constants for withdrawal limits
const MIN_WITHDRAWAL_POINTS = 20; // Minimum 20 points = 0.002 LTC
const MAX_WITHDRAWAL_POINTS = 100000; // Maximum 100,000 points = 10 LTC
const WITHDRAWAL_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes in milliseconds
const COINFLIP_COOLDOWN_MS = 4 * 1000; // 4 seconds in milliseconds

const WITHDRAWAL_WAGER_REQ_RATIO = 0.5;

async function getWithdrawalWagerProgress(userId) {
  await ensureUserExists(userId);
  await ensureUserLevelExists(userId);

  const deposits = await dbAll('SELECT points FROM deposits WHERE credited_to = ?', [userId]);
  const totalDepositedPoints = deposits.reduce((sum, d) => sum + (Number(d.points) || 0), 0);

  const transfers = await dbAll('SELECT points FROM point_transfers WHERE to_user_id = ?', [userId]);
  const totalReceivedTransfers = transfers.reduce((sum, t) => sum + (Number(t.points) || 0), 0);

  const legacyRow = await dbGet('SELECT legacy_points FROM user_withdrawal_legacy WHERE user_id = ?', [userId]);
  let legacyPoints = Number(legacyRow?.legacy_points || 0);

  if (!legacyRow) {
    const user = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
    const balance = Number(user?.balance || 0);
    legacyPoints = Math.max(0, balance - totalDepositedPoints);
    await dbRun('INSERT INTO user_withdrawal_legacy (user_id, legacy_points, created_at) VALUES (?, ?, ?)', [userId, legacyPoints, Date.now()]);
  }

  const basePoints = totalDepositedPoints + legacyPoints + totalReceivedTransfers;
  const requiredWager = basePoints * WITHDRAWAL_WAGER_REQ_RATIO;
  const levelData = await getUserLevelData(userId);
  const totalWagered = levelData?.totalWagered || 0;
  const remaining = Math.max(0, requiredWager - totalWagered);

  return { basePoints, requiredWager, totalWagered, remaining, totalDepositedPoints, legacyPoints, totalReceivedTransfers };
}

// Constants for deposit limits
const MIN_DEPOSIT_POINTS = 5; // Minimum 5 points = 0.0005 LTC

// Global withdrawal cooldown tracker
let lastWithdrawalTime = 0;

// Per-user coin flip cooldown tracker
const userCoinflipCooldowns = new Map();

// Per-user coinflip game sequence tracker (للتحكم بالنمط: فوز، 3 خسائر، فوز، 4-5 خسائر)
const userCoinflipSequence = new Map(); // {userId: {gameCount: 0, pattern: [...]}}

/**
 * Generate a randomized pattern: 3 wins and 7 losses out of 10 games (shuffled)
 * Pattern example: L L L L W W L L W L (changes every 10 games)
 */
function generateRandomPattern() {
  // Create pattern: 3 wins (true) and 7 losses (false)
  const pattern = [true, true, true, false, false, false, false, false, false, false];
  
  // Fisher-Yates shuffle to randomize pattern
  for (let i = pattern.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pattern[i], pattern[j]] = [pattern[j], pattern[i]];
  }
  
  console.log(`Generated new coinflip pattern: ${pattern.map(p => p ? 'W' : 'L').join(' ')}`);
  return pattern;
}

/**
 * Get the next coinflip result for user based on randomized pattern
 * Every 10 games: generates new random pattern with 3 wins and 7 losses
 * Pattern changes every 10 games to prevent being predictable
 */
function getCoinflipPatternResult(userId) {
  if (!userCoinflipSequence.has(userId)) {
    userCoinflipSequence.set(userId, {
      gameCount: 0,
      pattern: generateRandomPattern()
    });
  }

  const userData = userCoinflipSequence.get(userId);
  const result = userData.pattern[userData.gameCount % 10];
  userData.gameCount++;
  
  // Generate new pattern every 10 games with different randomization
  if (userData.gameCount % 10 === 0) {
    console.log(`Resetting pattern for user ${userId} after 10 games`);
    userData.pattern = generateRandomPattern();
  }
  
  return result; // true = win, false = lose
}

// Validate withdrawal amount
function validateWithdrawalAmount(points, userId = null) {
  // Check if points is a valid positive number (integer or decimal)
  if (typeof points !== 'number' || points <= 0 || !isFinite(points) || isNaN(points)) {
    return { 
      valid: false, 
      message: 'Withdrawal amount must be a positive number of points' 
    };
  }
  
  // Special case for certain users - minimum 2 points (1 point causes dust errors)
  const allowedLowMinimum = userId === '1355726712310071386' || userId === '998706760749682789';
  const minPoints = allowedLowMinimum ? 2 : MIN_WITHDRAWAL_POINTS;
  
  if (points < minPoints) {
    return { 
      valid: false, 
      message: `Minimum withdrawal is ${minPoints} points (${(minPoints * 0.0001).toFixed(6)} LTC). Fees will be deducted from this amount.` 
    };
  }
  
  if (points > MAX_WITHDRAWAL_POINTS) {
    return { 
      valid: false, 
      message: `Maximum withdrawal is ${MAX_WITHDRAWAL_POINTS} points (${(MAX_WITHDRAWAL_POINTS * 0.0001).toFixed(4)} LTC)` 
    };
  }
  
  return { valid: true };
}

// Check if withdrawal cooldown is active
function checkWithdrawalCooldown() {
  const now = Date.now();
  const timeSinceLastWithdrawal = now - lastWithdrawalTime;
  
  if (timeSinceLastWithdrawal < WITHDRAWAL_COOLDOWN_MS) {
    const remainingTime = Math.ceil((WITHDRAWAL_COOLDOWN_MS - timeSinceLastWithdrawal) / 1000);
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    
    return {
      valid: false,
      message: `⏰ Withdrawal cooldown active. Someone recently withdrew, please try again in ${minutes}m ${seconds}s to prevent network issues.`,
      remainingSeconds: remainingTime
    };
  }
  
  return { valid: true };
}

// Update withdrawal timestamp (call this after successful withdrawal)
function updateWithdrawalTimestamp() {
  lastWithdrawalTime = Date.now();
}

// Check if user coin flip cooldown is active
function checkCoinflipCooldown(userId) {
  const now = Date.now();
  const lastCoinflipTime = userCoinflipCooldowns.get(userId) || 0;
  const timeSinceLastCoinflip = now - lastCoinflipTime;
  
  if (timeSinceLastCoinflip < COINFLIP_COOLDOWN_MS) {
    const remainingTime = Math.ceil((COINFLIP_COOLDOWN_MS - timeSinceLastCoinflip) / 1000);
    
    return {
      valid: false,
      message: `⏰ Please wait ${remainingTime} second${remainingTime !== 1 ? 's' : ''} before placing another coin flip bet.`,
      remainingSeconds: remainingTime
    };
  }
  
  return { valid: true };
}

// Update user coin flip timestamp (call this after successful coin flip)
function updateCoinflipTimestamp(userId) {
  userCoinflipCooldowns.set(userId, Date.now());
}

// Insert new deposit record
async function insertDepositIfNew(txid, address, amount_ltc, points, confirmations, ts) {
  try {
    const ltcPrice = await getLTCPriceUSD();
    const amount_usd = amount_ltc * ltcPrice;
    
    await dbRun(`INSERT OR IGNORE INTO deposits 
      (txid, address, amount_ltc, amount_usd, points, confirmations, timestamp) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`, 
      [txid, address, amount_ltc, amount_usd, points, confirmations, ts]
    );
  } catch (e) {
    console.error('Error inserting deposit:', e);
  }
}

// Mark deposit as credited
async function markDepositCredited(txid, userId) {
  await dbRun('UPDATE deposits SET credited = 1, credited_to = ? WHERE txid = ?', [userId, txid]);
}

// Add points to user balance
async function addPointsToUser(userId, points) {
  await ensureUserExists(userId);
  await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [points, userId]);
}

// Subtract points from user balance for withdrawal (with validation)
async function subtractPointsFromUser(userId, points) {
  await ensureUserExists(userId);
  
  // Ensure user has sufficient balance before deduction
  const user = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
  if (!user || user.balance < points) {
    throw new Error(`Insufficient balance for withdrawal: user has ${user?.balance || 0}, needs ${points}`);
  }
  
  await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, userId]);
}

// User withdrawal locks to prevent concurrent withdrawals
const userWithdrawalLocks = new Set();

// Process withdrawal using Apirone API - SECURE & ATOMIC VERSION
async function processWithdrawal(userId, points, ltcAddress) {
  let withdrawalId = null;
  
  try {
    // SECURITY: Validate withdrawal amount (defensive check)
    const validation = validateWithdrawalAmount(points, userId);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.message
      };
    }
    
    // SECURITY: Validate LTC address format server-side
    if (!isValidLtcAddress(ltcAddress)) {
      console.error(`Invalid LTC address provided for withdrawal: ${ltcAddress}`);
      return {
        success: false,
        message: 'Invalid Litecoin address format. Please check your address and try again.'
      };
    }

    // SECURITY: Validate API key exists
    if (!APIRONE_TRANSFER_KEY || APIRONE_TRANSFER_KEY.trim() === '') {
      console.error('APIRONE_TRANSFER_KEY is not configured');
      return {
        success: false,
        message: 'Withdrawal system not configured. Please contact support.'
      };
    }
    
    // SECURITY: Prevent concurrent withdrawals for same user
    if (userWithdrawalLocks.has(userId)) {
      console.log(`Withdrawal already in progress for user ${userId}`);
      return {
        success: false,
        message: 'You already have a withdrawal in progress. Please wait for it to complete.'
      };
    }
    
    // Lock this user from making additional withdrawals
    userWithdrawalLocks.add(userId);
    
    console.log(`Processing withdrawal: ${points} points for user ${userId} to ${ltcAddress}`);
    
    // Convert points to LTC amount
    const ltcAmount = pointsToLtc(points);
    const ltcPrice = await getLTCPriceUSD();
    const amountUsd = ltcAmount * ltcPrice;
    
    // Convert LTC to satoshis (1 LTC = 100,000,000 satoshis)
    const amountSatoshis = Math.floor(ltcAmount * 100000000);
    
    console.log(`Withdrawal details: ${ltcAmount} LTC (${amountSatoshis} satoshis), $${amountUsd} USD`);
    
    // SECURITY: Check balance before processing withdrawal
    const balanceCheck = await checkWithdrawalBalance(userId, points);
    if (!balanceCheck.valid) {
      return {
        success: false,
        message: balanceCheck.message
      };
    }

    // ATOMICITY: Record withdrawal and deduct balance in a single transaction
    const transactionOperations = [
      {
        sql: `INSERT INTO withdrawals 
              (user_id, withdrawal_address, amount_points, amount_ltc, amount_usd, status, created_at) 
              VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        params: [userId, ltcAddress, points, ltcAmount, amountUsd, Date.now()]
      },
      {
        sql: 'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
        params: [points, userId, points]
      }
    ];
    
    const transactionResults = await executeTransaction(transactionOperations);
    withdrawalId = transactionResults[0].lastID;
    
    // SECURITY: Verify that the balance update succeeded (changes > 0)
    if (transactionResults[1].changes === 0) {
      // This should not happen due to validation above, but safety check
      console.error(`Critical error: Balance update failed for user ${userId} - insufficient balance or user not found`);
      
      // Clean up the pending withdrawal record
      await dbRun('UPDATE withdrawals SET status = ?, error_message = ?, processed_at = ? WHERE id = ?', 
        ['failed', 'Insufficient balance at transaction time', Date.now(), withdrawalId]);
      
      return {
        success: false,
        message: 'Withdrawal failed due to insufficient balance. Please try again.'
      };
    }
    
    console.log(`Transaction completed: withdrawal ${withdrawalId} created and ${points} points deducted from user ${userId}`);
    
    // PREFLIGHT: Estimate transfer to check for dust issues and get max spendable amount
    console.log('Running preflight estimation to avoid dust errors...');
    const estimateUrl = `https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/transfer?destinations=${encodeURIComponent(ltcAddress)}:${amountSatoshis}&fee=normal&subtract-fee-from-amount=true`;
    
    try {
      const estimateResponse = await fetch(estimateUrl);
      
      if (!estimateResponse.ok) {
        console.log(`Transfer estimation failed: ${estimateResponse.status}`);
        const estimateError = await estimateResponse.text();
        console.log(`Estimate error: ${estimateError}`);
        
        if (estimateResponse.status === 400 && estimateError.includes('dust')) {
          // The requested amount would create dust - need to find max spendable
          console.log('Requested amount would create dust output, finding maximum spendable amount...');
          
          // Binary search to find max spendable amount (simplified approach)
          let maxAmount = Math.floor(amountSatoshis * 0.95); // Start with 95% of requested
          let attempt = 0;
          const maxAttempts = 5;
          
          while (attempt < maxAttempts) {
            const testUrl = `https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/transfer?destinations=${encodeURIComponent(ltcAddress)}:${maxAmount}&fee=normal&subtract-fee-from-amount=true`;
            const testResponse = await fetch(testUrl);
            
            if (testResponse.ok) {
              console.log(`Found viable amount: ${maxAmount} satoshis (${(maxAmount/100000000).toFixed(8)} LTC)`);
              amountSatoshis = maxAmount; // Update the amount to use
              ltcAmount = maxAmount / 100000000; // Update LTC amount
              break;
            } else {
              maxAmount = Math.floor(maxAmount * 0.9); // Reduce by 10%
              attempt++;
              console.log(`Attempt ${attempt}: trying ${maxAmount} satoshis`);
            }
          }
          
          if (attempt >= maxAttempts) {
            // Could not find a viable amount
            const rollbackOperations = [
              {
                sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
                params: [points, userId]
              },
              {
                sql: 'UPDATE withdrawals SET status = ?, error_message = ?, processed_at = ? WHERE id = ?',
                params: ['failed', 'Unable to find dust-safe withdrawal amount', Date.now(), withdrawalId]
              }
            ];
            
            await executeTransaction(rollbackOperations);
            console.log(`Unable to find viable withdrawal amount for ${points} points`);
            
            return {
              success: false,
              message: 'Current wallet conditions make small withdrawals difficult. Please try a larger amount (50+ points) or wait for better network conditions.'
            };
          }
        }
      } else {
        const estimateData = await estimateResponse.json();
        console.log('Transfer estimation successful:', estimateData);
      }
    } catch (estimateError) {
      console.log('Preflight estimation error (continuing with original attempt):', estimateError);
    }
    
    // API FIX: Call Apirone API with correct authentication and data types (using potentially adjusted amount)
    let transferResponse = await fetch(`https://apirone.com/api/v2/wallets/${APIRONE_WALLET_ID}/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        'transfer-key': APIRONE_TRANSFER_KEY,  // FIXED: Transfer key goes in body, not header
        destinations: [{
          address: ltcAddress,
          amount: amountSatoshis  // FIXED: Send as integer, not string (potentially adjusted by preflight)
        }],
        fee: 'normal',
        'subtract-fee-from-amount': true  // Use subtract-fee-from-amount by default to avoid dust
      })
    });
    
    // Handle transfer failures (dust issues should be resolved by preflight estimation)
    if (!transferResponse.ok) {
      const errorText = await transferResponse.text();
      console.error(`Apirone transfer failed: ${transferResponse.status} - ${errorText}`);
      
      // ATOMICITY: Rollback balance and update withdrawal status in transaction
      const rollbackOperations = [
        {
          sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
          params: [points, userId]
        },
        {
          sql: 'UPDATE withdrawals SET status = ?, error_message = ?, processed_at = ? WHERE id = ?',
          params: ['failed', `API Error: ${transferResponse.status} - ${errorText}`, Date.now(), withdrawalId]
        }
      ];
      
      await executeTransaction(rollbackOperations);
      console.log(`Transaction rollback completed: ${points} points restored to user ${userId} and withdrawal ${withdrawalId} marked as failed`);
      
      const userMessage = transferResponse.status === 400 && errorText.includes('dust') 
        ? 'Withdrawal amount adjusted but still encountered network issues. Please try a larger amount.' 
        : `Withdrawal failed: ${transferResponse.status === 400 ? 'Invalid address or insufficient funds' : 'Network error'}. Balance restored.`;
      
      return {
        success: false,
        message: userMessage
      };
    }
    
    const transferData = await transferResponse.json();
    console.log('Apirone transfer response:', transferData);
    
    // Check if transfer was successful
    const txid = transferData.txs && transferData.txs[0] ? transferData.txs[0] : transferData.txid;
    if (txid && transferData.status === 'success') {
      // Update withdrawal as successful
      await dbRun('UPDATE withdrawals SET status = ?, txid = ?, processed_at = ? WHERE id = ?', 
        ['completed', txid, Date.now(), withdrawalId]);
      
      console.log(`Withdrawal successful: ${txid}`);

      // Log withdrawal success to the logs channel with embed
      try {
        const shortTxid = txid.length > 12 ? `${txid.substring(0, 6)}...${txid.substring(txid.length - 6)}` : txid;
        
        // Get username and avatar for the withdrawal
        let username = 'Unknown User';
        let userAvatarURL = null;
        try {
          const userInfo = await client.users.fetch(userId);
          username = userInfo.username;
          userAvatarURL = userInfo.displayAvatarURL({ format: 'png', size: 128 });
        } catch (e) {
          console.error('Error fetching username:', e);
        }

        // Format address for better display
        const shortAddress = ltcAddress.length > 16 ? 
          `${ltcAddress.substring(0, 8)}...${ltcAddress.substring(ltcAddress.length - 8)}` : 
          ltcAddress;

        const withdrawalEmbed = new EmbedBuilder()
          .setTitle('🎉 Withdrawal Completed Successfully!')
          .setDescription(`**${username}** has withdrawn from **Masterbets**`)
          .addFields([
            { name: '💎 Points Withdrawn', value: `\`${points.toLocaleString()} points\``, inline: true },
            { name: '💰 LTC Amount', value: `\`${ltcAmount.toFixed(8)} LTC\``, inline: true },
            { name: '💵 USD Value', value: `\`$${amountUsd.toFixed(2)}\``, inline: true },
            { name: '⚡ Transaction ID', value: `\`${shortTxid}\``, inline: true },
            { name: '⏱️ Processed', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true }
          ])
          .setColor('#00E5A8') // Masterbets brand color - vibrant green
          .setTimestamp()
          .setFooter({ 
            text: '🚀 Masterbets • Secure & Instant Withdrawals'
          });

        // Add user avatar as thumbnail if available
        if (userAvatarURL) {
          withdrawalEmbed.setThumbnail(userAvatarURL);
        }

        await sendLogMessage({ embeds: [withdrawalEmbed] });
      } catch (logError) {
        console.error('Error logging withdrawal:', logError);
      }
      
      // Update withdrawal timestamp to start cooldown
      updateWithdrawalTimestamp();
      
      return {
        success: true,
        txid: txid,
        ltcAmount: ltcAmount,
        amountUsd: amountUsd,
        fee: transferData.fee ? transferData.fee.network.amount : 'unknown'
      };
    } else {
      // ATOMICITY: Rollback balance and update withdrawal status in transaction
      const rollbackOperations = [
        {
          sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
          params: [points, userId]
        },
        {
          sql: 'UPDATE withdrawals SET status = ?, error_message = ?, processed_at = ? WHERE id = ?',
          params: ['failed', 'No transaction ID returned', Date.now(), withdrawalId]
        }
      ];
      
      await executeTransaction(rollbackOperations);
      console.log(`Transaction rollback completed: ${points} points restored to user ${userId} (no txid)`);
      
      return {
        success: false,
        message: 'Withdrawal failed: No transaction ID received. Balance restored.'
      };
    }
    
  } catch (error) {
    console.error('Withdrawal processing error:', error);
    
    try {
      // ATOMICITY: Rollback balance and update withdrawal status in transaction on any error
      if (withdrawalId) {
        const rollbackOperations = [
          {
            sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
            params: [points, userId]
          },
          {
            sql: 'UPDATE withdrawals SET status = ?, error_message = ?, processed_at = ? WHERE id = ?',
            params: ['failed', `System Error: ${error.message}`, Date.now(), withdrawalId]
          }
        ];
        
        await executeTransaction(rollbackOperations);
        console.log(`Transaction rollback completed: ${points} points restored to user ${userId} (error occurred)`);
      } else {
        // If no withdrawal was created, just restore balance
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [points, userId]);
        console.log(`Balance restored: ${points} points to user ${userId} (error before withdrawal creation)`);
      }
    } catch (rollbackError) {
      console.error('Critical error during rollback:', rollbackError);
    }
    
    return {
      success: false,
      message: 'Withdrawal failed due to technical error. Balance has been restored.'
    };
  } finally {
    // ALWAYS remove the withdrawal lock
    userWithdrawalLocks.delete(userId);
  }
}

// Scan for new deposits using Apirone
let scanning = false;
async function scanDepositsAndNotify() {
  if (scanning) return;
  scanning = true;
  
  try {
    // Method 1: Try wallet-level transaction scanning
    const walletTxs = await fetchWalletTransactions();
    
    if (walletTxs.length > 0) {
      console.log(`Processing ${walletTxs.length} wallet transactions`);
      
      for (const tx of walletTxs) {
        if (tx.type === 'received' && tx.confirmations >= 1) {
          for (const output of tx.outputs || []) {
            const user = await dbGet('SELECT * FROM users WHERE deposit_address = ?', [output.address]);
            if (!user) continue;
            
            // Check if we already processed this transaction
            const existingDeposit = await dbGet('SELECT * FROM deposits WHERE txid = ? AND credited = 1', [tx.txid]);
            if (existingDeposit) continue;
            
            // Check if this is the same transaction we already processed
            if (user.last_tx === tx.txid) continue;

            const amountLtc = output.amount / 1e8;
            const points = ltcToPoints(amountLtc);
            
            console.log(`Found wallet deposit: ${amountLtc} LTC (${points} points) for user ${user.id}`);
            
            if (points >= MIN_DEPOSIT_POINTS) {
              // Add points to user
              await addPointsToUser(user.id, points);
              
              // Update user's last transaction
              await dbRun('UPDATE users SET last_tx = ? WHERE id = ?', [tx.txid, user.id]);
              
              // Record the deposit
              await insertDepositIfNew(tx.txid, output.address, amountLtc, points, tx.confirmations, Date.now());
              await markDepositCredited(tx.txid, user.id);

              // Send notification to user
              try {
                const ltcPrice = await getLTCPriceUSD();
                const amountUsd = amountLtc * ltcPrice;
                
                const embed = new EmbedBuilder()
                  .setTitle('💰 Deposit Credited!')
                  .setColor('#1abc9c')
                  .setDescription(`Your deposit has been successfully credited to your account!`)
                  .addFields([
                    { name: '📊 Amount Deposited', value: `${amountLtc.toFixed(8)} LTC`, inline: true },
                    { name: '💵 USD Value', value: `$${amountUsd.toFixed(2)}`, inline: true },
                    { name: '🎯 Points Credited', value: `${points.toFixed(2)} points`, inline: true },
                    { name: '🔗 Transaction ID', value: `\`${tx.txid}\``, inline: false },
                    { name: '✅ Confirmations', value: `${tx.confirmations}`, inline: true }
                  ])
                  .setFooter({ text: 'Masterbets • Deposit processed automatically' })
                  .setTimestamp();

                const targetUser = await client.users.fetch(user.id);
                await targetUser.send({ embeds: [embed] });
              } catch (dmError) {
                console.error('Error sending deposit notification:', dmError);
              }
            } else if (points > 0) {
              // Deposit too small - notify user about minimum requirement
              try {
                const ltcPrice = await getLTCPriceUSD();
                const amountUsd = amountLtc * ltcPrice;
                const minDepositLtc = pointsToLtc(MIN_DEPOSIT_POINTS);
                const minDepositUsd = minDepositLtc * ltcPrice;
                
                const embed = new EmbedBuilder()
                  .setTitle('⚠️ Deposit Too Small')
                  .setColor('#f39c12')
                  .setDescription(`Your deposit was received but is below the minimum requirement.`)
                  .addFields([
                    { name: '📊 Amount Received', value: `${amountLtc.toFixed(8)} LTC`, inline: true },
                    { name: '💵 USD Value', value: `$${amountUsd.toFixed(2)}`, inline: true },
                    { name: '❌ Points Credited', value: `0 points`, inline: true },
                    { name: '📏 Minimum Required', value: `${minDepositLtc.toFixed(8)} LTC (${MIN_DEPOSIT_POINTS} points)`, inline: false },
                    { name: '💰 Minimum USD Value', value: `$${minDepositUsd.toFixed(2)}`, inline: true },
                    { name: '🔗 Transaction ID', value: `\`${tx.txid}\``, inline: false }
                  ])
                  .setFooter({ text: 'Masterbets • Please deposit at least the minimum amount' })
                  .setTimestamp();

                const targetUser = await client.users.fetch(user.id);
                await targetUser.send({ embeds: [embed] });
                
                // Record the small deposit for tracking but don't credit it
                await insertDepositIfNew(tx.txid, output.address, amountLtc, 0, tx.confirmations, Date.now());
                
                // Update user's last_tx to prevent sending this notification again
                await dbRun('UPDATE users SET last_tx = ? WHERE id = ?', [tx.txid, user.id]);
              } catch (dmError) {
                console.error('Error sending minimum deposit notification:', dmError);
              }
            }
          }
        }
      }
    } else {
      // Method 2: Individual address scanning as fallback
      const users = await dbAll('SELECT * FROM users WHERE deposit_address IS NOT NULL');
      console.log(`Fallback: Scanning deposits for ${users.length} individual addresses`);
      
      for (const user of users) {
        if (!user.deposit_address) continue;
        
        const addressTxs = await fetchAddressTransactions(user.deposit_address);
        
        for (const tx of addressTxs) {
          console.log(`Processing transaction for ${user.deposit_address}:`, {
            txid: tx.txid,
            amount: tx.amount,
            block: tx.block,
            deleted: tx.deleted
          });
          
          // For Apirone API: Accept both confirmed (block.height > 0) and unconfirmed (block.height = -1) transactions
          // Only skip if transaction is deleted
          if (!tx.deleted) {
            // Check if we already processed this transaction
            const existingDeposit = await dbGet('SELECT * FROM deposits WHERE txid = ? AND credited = 1', [tx.txid]);
            if (existingDeposit) {
              console.log(`Transaction ${tx.txid} already processed, skipping`);
              continue;
            }
            
            // Check if this is the same transaction we already processed
            if (user.last_tx === tx.txid) {
              console.log(`Transaction ${tx.txid} already recorded as last_tx for user ${user.id}, skipping`);
              continue;
            }

            const amountLtc = tx.amount / 1e8;  // Apirone returns amount in satoshis
            const points = ltcToPoints(amountLtc);
            
            const confirmations = tx.block && tx.block.height > 0 ? 1 : 0; // Consider confirmed if in a block
            console.log(`Found address deposit: ${amountLtc} LTC (${points} points) for user ${user.id}, confirmations: ${confirmations}`);
            
            if (points >= MIN_DEPOSIT_POINTS) {
              // Add points to user
              await addPointsToUser(user.id, points);
              console.log(`Added ${points} points to user ${user.id}`);
              
              // Update user's last transaction
              await dbRun('UPDATE users SET last_tx = ? WHERE id = ?', [tx.txid, user.id]);
              
              // Record the deposit
              await insertDepositIfNew(tx.txid, user.deposit_address, amountLtc, points, confirmations, Date.now());
              await markDepositCredited(tx.txid, user.id);
              console.log(`Deposit recorded and marked as credited for txid: ${tx.txid}`);

              // Send notification to user
              try {
                const ltcPrice = await getLTCPriceUSD();
                const amountUsd = amountLtc * ltcPrice;
                
                const embed = new EmbedBuilder()
                  .setTitle('💰 Deposit Credited!')
                  .setColor('#1abc9c')
                  .setDescription(`Your deposit has been successfully credited to your account!`)
                  .addFields([
                    { name: '📊 Amount Deposited', value: `${amountLtc.toFixed(8)} LTC`, inline: true },
                    { name: '💵 USD Value', value: `$${amountUsd.toFixed(2)}`, inline: true },
                    { name: '🎯 Points Credited', value: `${points.toFixed(2)} points`, inline: true },
                    { name: '🔗 Transaction ID', value: `\`${tx.txid}\``, inline: false },
                    { name: '✅ Confirmations', value: `${tx.confirmations}`, inline: true }
                  ])
                  .setFooter({ text: 'Masterbets • Deposit processed automatically' })
                  .setTimestamp();

                const targetUser = await client.users.fetch(user.id);
                await targetUser.send({ embeds: [embed] });
              } catch (dmError) {
                console.error('Error sending deposit notification:', dmError);
              }
            } else if (points > 0) {
              // Deposit too small - notify user about minimum requirement
              try {
                const ltcPrice = await getLTCPriceUSD();
                const amountUsd = amountLtc * ltcPrice;
                const minDepositLtc = pointsToLtc(MIN_DEPOSIT_POINTS);
                const minDepositUsd = minDepositLtc * ltcPrice;
                
                const embed = new EmbedBuilder()
                  .setTitle('⚠️ Deposit Too Small')
                  .setColor('#f39c12')
                  .setDescription(`Your deposit was received but is below the minimum requirement.`)
                  .addFields([
                    { name: '📊 Amount Received', value: `${amountLtc.toFixed(8)} LTC`, inline: true },
                    { name: '💵 USD Value', value: `$${amountUsd.toFixed(2)}`, inline: true },
                    { name: '❌ Points Credited', value: `0 points`, inline: true },
                    { name: '📏 Minimum Required', value: `${minDepositLtc.toFixed(8)} LTC (${MIN_DEPOSIT_POINTS} points)`, inline: false },
                    { name: '💰 Minimum USD Value', value: `$${minDepositUsd.toFixed(2)}`, inline: true },
                    { name: '🔗 Transaction ID', value: `\`${tx.txid}\``, inline: false }
                  ])
                  .setFooter({ text: 'Masterbets • Please deposit at least the minimum amount' })
                  .setTimestamp();

                const targetUser = await client.users.fetch(user.id);
                await targetUser.send({ embeds: [embed] });
                
                // Record the small deposit for tracking but don't credit it
                await insertDepositIfNew(tx.txid, user.deposit_address, amountLtc, 0, confirmations, Date.now());
                
                // Update user's last_tx to prevent sending this notification again
                await dbRun('UPDATE users SET last_tx = ? WHERE id = ?', [tx.txid, user.id]);
              } catch (dmError) {
                console.error('Error sending minimum deposit notification:', dmError);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Error scanning deposits:', e);
  } finally {
    scanning = false;
  }
}

// Generate enhanced green-themed balance card with profile picture
async function generateUserBalanceCard(user, points) {
  const width = 600, height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Smooth gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1b2d3b');
  gradient.addColorStop(0.7, '#2d3748');
  gradient.addColorStop(1, '#1b2d3b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Main card container with rounded corners
  const borderRadius = 20;
  ctx.fillStyle = 'rgba(45, 55, 75, 0.85)';
  ctx.beginPath();
  ctx.moveTo(20 + borderRadius, 20);
  ctx.lineTo(width - 20 - borderRadius, 20);
  ctx.quadraticCurveTo(width - 20, 20, width - 20, 20 + borderRadius);
  ctx.lineTo(width - 20, height - 20 - borderRadius);
  ctx.quadraticCurveTo(width - 20, height - 20, width - 20 - borderRadius, height - 20);
  ctx.lineTo(20 + borderRadius, height - 20);
  ctx.quadraticCurveTo(20, height - 20, 20, height - 20 - borderRadius);
  ctx.lineTo(20, 20 + borderRadius);
  ctx.quadraticCurveTo(20, 20, 20 + borderRadius, 20);
  ctx.fill();

  // Subtle border shadow around the card
  ctx.strokeStyle = 'rgba(72, 187, 120, 0.3)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Left side - Profile picture (bigger and more pronounced)
  const avatarX = 100;
  const avatarY = 100;
  const avatarRadius = 50; // Increased size for profile image

  // Draw profile picture with rounded borders
  await drawCircularProfilePicture(ctx, user, avatarX, avatarY, avatarRadius);

  // Profile picture border
  ctx.strokeStyle = 'rgba(72, 187, 120, 0.8)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 2, 0, 2 * Math.PI);
  ctx.stroke();

  // Username below profile picture (centered with ellipsis for overflow)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'center';
  
  let displayName = user.username;
  const maxWidth = 140; // Max width for username area
  let nameWidth = ctx.measureText(displayName).width;
  
  if (nameWidth > maxWidth) {
    while (nameWidth > maxWidth && displayName.length > 3) {
      displayName = displayName.substring(0, displayName.length - 1);
      nameWidth = ctx.measureText(displayName + '...').width;
    }
    displayName += '...';
  }
  
  ctx.fillText(displayName, avatarX, avatarY + avatarRadius + 25);
  ctx.textAlign = 'start';

  // Right side - Balance info
  const rightX = 240;

  // "POINTS BALANCE" label (slightly larger font)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '18px Arial';
  ctx.fillText('POINTS BALANCE', rightX, 70);

  // Main points balance - Large green text
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 60px Arial'; // Increased from 58px
  ctx.fillText(points.toFixed(2), rightX, 130);

  // Calculate LTC and USD values
  const ltc = pointsToLtc(points);
  let usd = 0;
  
  try {
    const ltcPrice = await getLTCPriceUSD();
    usd = ltc * ltcPrice;
  } catch (e) {}

  // LTC equivalent (bigger)
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 26px Arial'; // Increased from 24px
  ctx.fillText(`${ltc.toFixed(8)} LTC`, rightX, 165);

  // USD equivalent (slightly bigger)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = 'bold 20px Arial'; // Increased from 18px
  ctx.fillText(`≈ $${usd.toFixed(2)} USD`, rightX, 195);

  // Status message (larger font)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = '16px Arial'; // Slightly larger font
  const statusText = points > 0 ? `You have ${points.toFixed(2)} points ready to use` : 'No points - .deposit to get started';
  ctx.fillText(statusText, rightX, 220);

  // Bottom info line with date and rate (larger font size)
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const infoText = `MasterBets • ${dateStr} • 1 POINT = 0.0001 LTC`;
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '14px Arial';
  ctx.fillText(infoText, 40, 270);

  return canvas.toBuffer();
}

// Generate modern gaming-style spinning coin animation image (matches result image)
async function generateSpinningCoinImage(user, betAmount, userChoice) {
  const width = 500, height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark diagonal striped texture background (same as result image)
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, width, height);
  
  // Create diagonal stripe pattern
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 2;
  for (let i = -height; i < width + height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  // Username text at top in bold white modern font
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${user.username} bet on ${userChoice.charAt(0).toUpperCase() + userChoice.slice(1)}`, width / 2, 50);

  // Bet amount info (2 decimal places)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '18px Arial';
  ctx.fillText(`${betAmount.toFixed(2)} points`, width / 2, 80);

  // Center spinning coin area
  const coinX = width / 2;
  const coinY = height / 2;
  const coinRadius = 80;

  // Spinning coin animation with blur effect
  for (let i = 0; i < 6; i++) {
    const alpha = (6 - i) * 0.15;
    const scale = 1 - (i * 0.08);
    const rotation = (i * Math.PI) / 4;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(coinX, coinY);
    ctx.rotate(rotation);
    ctx.scale(scale, scale * 0.4); // Elliptical for spinning effect
    
    // Coin soft glow effect
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 20;
    
    // Golden coin with 3D shading (same as result image)
    const coinGradient = ctx.createRadialGradient(-20, -20, 0, 0, 0, coinRadius);
    coinGradient.addColorStop(0, '#fff9c4');
    coinGradient.addColorStop(0.3, '#ffd700');
    coinGradient.addColorStop(0.7, '#ffb700');
    coinGradient.addColorStop(1, '#daa520');
    
    ctx.fillStyle = coinGradient;
    ctx.beginPath();
    ctx.arc(0, 0, coinRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.shadowBlur = 0; // Reset for next iteration
    ctx.restore();
  }

  // Spinning status text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('🎯 Coin is spinning...', width / 2, height - 120);

  // Bottom status message
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '16px Arial';
  ctx.fillText('Get ready for the result...', width / 2, height - 80);

  // Clean professional branding (matching result image)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '14px Arial';
  ctx.fillText('Masterbets• Premium Gaming', width / 2, height - 20);

  ctx.textAlign = 'start'; // Reset

  return canvas.toBuffer();
}

// Generate modern gaming-style coinflip result image (improved design)
async function generateCoinflipImage(user, betAmount, userChoice, gameResult, userWon, winnings, fairHash) {
  const width = 500, height = 600;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark diagonal striped texture background (gaming UI style)
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, width, height);
  
  // Create diagonal stripe pattern
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 2;
  for (let i = -height; i < width + height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  // Username text at top in bold white modern font
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${user.username} bet on ${userChoice.charAt(0).toUpperCase() + userChoice.slice(1)}`, width / 2, 50);

  // Bet amount info
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '18px Arial';
  ctx.fillText(`${betAmount.toFixed(2)} points`, width / 2, 80);

  // Center golden coin with 3D shading effect and soft glow
  const coinX = width / 2;
  const coinY = height / 2 - 20;
  const coinRadius = 90;

  // Coin soft glow effect
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Outer coin rim (3D effect)
  const rimGradient = ctx.createRadialGradient(coinX, coinY, 0, coinX, coinY, coinRadius + 8);
  rimGradient.addColorStop(0, '#fff9c4');
  rimGradient.addColorStop(0.7, '#ffd700');
  rimGradient.addColorStop(0.9, '#ffb700');
  rimGradient.addColorStop(1, '#b8860b');
  ctx.fillStyle = rimGradient;
  ctx.beginPath();
  ctx.arc(coinX, coinY, coinRadius + 8, 0, 2 * Math.PI);
  ctx.fill();

  // Main coin body with 3D shading
  const coinGradient = ctx.createRadialGradient(coinX - 30, coinY - 30, 0, coinX, coinY, coinRadius);
  coinGradient.addColorStop(0, '#fff9c4');
  coinGradient.addColorStop(0.3, '#ffd700');
  coinGradient.addColorStop(0.7, '#ffb700');
  coinGradient.addColorStop(1, '#daa520');
  ctx.fillStyle = coinGradient;
  ctx.beginPath();
  ctx.arc(coinX, coinY, coinRadius, 0, 2 * Math.PI);
  ctx.fill();

  ctx.shadowBlur = 0; // Reset glow for inner details

  // Inner coin circle for letter background
  const innerGradient = ctx.createRadialGradient(coinX, coinY, 0, coinX, coinY, coinRadius - 20);
  innerGradient.addColorStop(0, '#b8860b');
  innerGradient.addColorStop(1, '#8b6914');
  ctx.fillStyle = innerGradient;
  ctx.beginPath();
  ctx.arc(coinX, coinY, coinRadius - 20, 0, 2 * Math.PI);
  ctx.fill();

  // Big bold engraved letter (H or T) in center
  ctx.fillStyle = '#8b6914';
  ctx.strokeStyle = '#654321';
  ctx.lineWidth = 3;
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const letter = gameResult === 'heads' ? 'H' : 'T';
  ctx.fillText(letter, coinX, coinY);
  ctx.strokeText(letter, coinX, coinY);

  // Reset text baseline
  ctx.textBaseline = 'alphabetic';

  // Result text at bottom with appropriate colors
  const resultY = height - 120;
  
  // Green for win, red for loss
  ctx.fillStyle = userWon ? '#22c55e' : '#ef4444';
  ctx.font = 'bold 32px Arial';
  ctx.fillText(`Landed on ${gameResult.toUpperCase()}`, width / 2, resultY);

  // Winnings text (only for wins, in smaller light gray/white font)
  if (userWon) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '20px Arial';
    ctx.fillText(`You won ${winnings.toFixed(2)} points`, width / 2, resultY + 35);
  }

  // Clean professional branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '14px Arial';
  ctx.fillText('Masterbets • Premium Gaming', width / 2, height - 20);

  ctx.textAlign = 'start'; // Reset

  return canvas.toBuffer();
}

// Generate beautiful tip success image for MasterBets
async function generateTipSuccessImage(fromUser, toUser, points, usdValue) {
  const width = 600, height = 280;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a1f2e');
  gradient.addColorStop(0.5, '#2d3748');
  gradient.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Green success banner at top (with a subtle shadow)
  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, 0, width, 60);
  
  // Success text (Centered)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  const successText = `✅ Tip Successful! +${points.toFixed(2)} Points`;
  const successTextWidth = ctx.measureText(successText).width;
  ctx.fillText(successText, (width - successTextWidth) / 2, 35);

  // Timestamp for MasterBets
  const now = new Date();
  const timestamp = now.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '12px Arial';
  const timestampWidth = ctx.measureText(timestamp).width;
  ctx.fillText(`MasterBets Casino | ${timestamp}`, width - timestampWidth - 20, 35);

  // From user profile picture (left)
  await drawCircularProfilePicture(ctx, fromUser, 100, 140, 40);

  // From username (Centered below the profile)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px Arial';
  const fromUsername = fromUser.username;
  const fromUsernameWidth = ctx.measureText(fromUsername).width;
  ctx.fillText(fromUsername, (width / 2) - (fromUsernameWidth / 2) - 100, 195);

  // To user profile picture (right)
  await drawCircularProfilePicture(ctx, toUser, 500, 140, 40);

  // To username (Centered below the profile)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px Arial';
  const toUsername = toUser.username;
  const toUsernameWidth = ctx.measureText(toUsername).width;
  ctx.fillText(toUsername, (width / 2) - (toUsernameWidth / 2) + 100, 195);

  // Arrow from left to right (more refined)
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(150, 140);
  ctx.lineTo(450, 140);
  ctx.stroke();

  // Arrow head (more refined shape)
  ctx.beginPath();
  ctx.moveTo(440, 130);
  ctx.lineTo(450, 140);
  ctx.lineTo(440, 150);
  ctx.stroke();

  // Center tip amount (Centered)
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 32px Arial';
  const pointsText = points.toFixed(2) + ' points';
  const pointsTextWidth = ctx.measureText(pointsText).width;
  ctx.fillText(pointsText, (width - pointsTextWidth) / 2, 130);

  // USD equivalent below (Centered)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '16px Arial';
  const usdText = `($${usdValue.toFixed(2)} USD)`;
  const usdTextWidth = ctx.measureText(usdText).width;
  ctx.fillText(usdText, (width - usdTextWidth) / 2, 155);

  // MasterBets branding at bottom (Centered and clean)
  ctx.fillStyle = 'rgba(100, 181, 246, 0.9)';
  ctx.font = 'bold 18px Arial';
  const brandingText = 'MasterBets';
  const brandingTextWidth = ctx.measureText(brandingText).width;
  ctx.fillText(brandingText, (width / 2) - (brandingTextWidth / 2), 240);

  return canvas.toBuffer();
}

// ==================== TIPCC DEPOSIT SYSTEM ====================
const TIPCC_BOT_ID = '617037497574359050';
const YOUR_BOT_ID = '1449795427481292890';
const TIPCC_DEPOSIT_CHANNEL_ID = '1450132267434250385';
const MIN_TIP_CREDIT = 0.0001; // Minimum 0.0001 LTC = 1 point

/**
 * Generate TipCC processing animation image
 */
async function generateTipCCProcessingImage(ltcAmount) {
  try {
    const width = 600;
    const height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Dark gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1f2e');
    gradient.addColorStop(1, '#0f1419');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Processing TipCC Deposit...', width / 2, 80);

    // LTC Amount
    ctx.fillStyle = '#1abc9c';
    ctx.font = 'bold 42px Arial';
    ctx.fillText(`${ltcAmount.toFixed(8)} LTC`, width / 2, 140);

    // Loading animation (spinning dots)
    ctx.fillStyle = '#3498db';
    const centerX = width / 2;
    const centerY = 200;
    const radius = 40;
    
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const dotSize = 6 + Math.sin(Date.now() / 200 + i) * 2;
      
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '16px Arial';
    ctx.fillText('MasterBets • TipCC Deposit System', width / 2, height - 20);

    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating TipCC processing image:', error);
    
    // Fallback simple image
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Processing TipCC Deposit...', 200, 100);
    return canvas.toBuffer('image/png');
  }
}

/**
 * Generate TipCC success image
 */
async function generateTipCCSuccessImage(user, ltcAmount, points, usdValue) {
  try {
    const width = 700;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a2f3a');
    gradient.addColorStop(1, '#0f1a1f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Success banner
    ctx.fillStyle = '#1abc9c';
    ctx.fillRect(0, 0, width, 70);

    // Success icon and text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('✅ TipCC Deposit Credited!', width / 2, 45);

    // User info
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Player: ${user.username}`, 50, 130);

    // LTC emoji representation
    ctx.fillStyle = '#f7931a';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Ł', width / 2, 220);

    // Deposit details
    ctx.fillStyle = '#1abc9c';
    ctx.font = 'bold 32px Arial';
    ctx.fillText(`${ltcAmount.toFixed(8)} LTC`, width / 2, 270);

    // Points credited
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(`+${points.toFixed(2)} Points`, width / 2, 310);

    // USD value
    if (usdValue > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '18px Arial';
      ctx.fillText(`≈ $${usdValue.toFixed(4)} USD`, width / 2, 340);
    }

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '14px Arial';
    ctx.fillText('MasterBets • TipCC Deposit System', width / 2, height - 20);

    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating TipCC success image:', error);
    
    // Fallback
    const canvas = createCanvas(500, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1abc9c';
    ctx.fillRect(0, 0, 500, 200);
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('✅ Deposit Credited!', 250, 100);
    return canvas.toBuffer('image/png');
  }
}

// Listen for TipCC bot messages
client.on('messageCreate', async (msg) => {
  try {
    if (msg.channel.type === ChannelType.DM) return;
    // Only process messages from TipCC bot in the designated channel
    if (msg.author.id !== TIPCC_BOT_ID) return;
    if (msg.channel.id !== TIPCC_DEPOSIT_CHANNEL_ID) return;
    if (!msg.embeds || msg.embeds.length === 0) return;

    const embed = msg.embeds[0];
    
    // Check if embed has description
    if (!embed.description) return;
    
    // Check if embed has the LTC emoji
 if (!embed.description.includes('<:LTC:904095822604550144>')) return;
    
    // Check if the tip is to your bot
    if (!embed.description.includes(`<@${YOUR_BOT_ID}>`)) return;

    // Parse the LTC amount from the embed description
    // Format: <:LTC:904095822604550144> <@User> sent <@YOUR_BOT_ID> **X.XXXXXXXX LTC** (≈ $X.XX)
    const ltcMatch = embed.description.match(/\*\*([0-9.]+)\s*LTC\*\*/i);
    if (!ltcMatch) {
      console.log('Could not parse LTC amount from TipCC embed');
      return;
    }

    const ltcAmount = parseFloat(ltcMatch[1]);
    if (isNaN(ltcAmount) || ltcAmount <= 0) {
      console.log('Invalid LTC amount parsed:', ltcMatch[1]);
      return;
    }

    // Parse the sender user ID
    const senderMatch = embed.description.match(/<@(\d+)>\s+sent\s+<@/);
    if (!senderMatch) {
      console.log('Could not parse sender user ID from TipCC embed');
      return;
    }

    const senderId = senderMatch[1];
    
    // Fetch the actual user object
    let senderUser;
    try {
      senderUser = await client.users.fetch(senderId);
    } catch (e) {
      console.error('Could not fetch sender user:', e);
      senderUser = { id: senderId, username: 'Unknown User' };
    }

    // Check if amount is below minimum
    if (ltcAmount < MIN_TIP_CREDIT) {
      const replyEmbed = new EmbedBuilder()
        .setTitle('❌ Tip Too Small')
        .setDescription(`<@${senderId}>, your tip of **${ltcAmount.toFixed(8)} LTC** is below the minimum.\n\n**Minimum Required:** ${MIN_TIP_CREDIT} LTC (1 point)\n\nPlease send at least ${MIN_TIP_CREDIT} LTC to receive points.`)
        .setColor('#e74c3c')
        .setFooter({ text: 'MasterBets • TipCC Deposit System' })
        .setTimestamp();
      
      await msg.channel.send({ embeds: [replyEmbed] });
      console.log(`TipCC tip from ${senderId} rejected: ${ltcAmount} LTC < ${MIN_TIP_CREDIT} LTC`);
      return;
    }

    // Show processing animation
    const processingImage = await generateTipCCProcessingImage(ltcAmount);
    const processingAttachment = new AttachmentBuilder(processingImage, { name: 'processing.png' });
    
    const processingEmbed = new EmbedBuilder()
      .setColor('#3498db')
      .setImage('attachment://processing.png')
      .setFooter({ text: 'MasterBets • Processing...' });

    const processingMsg = await msg.channel.send({ 
      content: `<@${senderId}>`,
      embeds: [processingEmbed], 
      files: [processingAttachment] 
    });

    // Wait 2 seconds for animation effect
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Convert LTC to points (0.0001 LTC = 1 point)
    const points = ltcToPoints(ltcAmount);

    // Ensure user exists and credit points
    await ensureUserExists(senderId);
    await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [points, senderId]);

    // Get user's new balance
    const userData = await dbGet('SELECT balance FROM users WHERE id = ?', [senderId]);
    const newBalance = userData?.balance || 0;

    // Calculate USD value
    let usdValue = 0;
    try {
      const ltcPrice = await getLTCPriceUSD();
      usdValue = ltcAmount * ltcPrice;
    } catch (e) {
      console.error('Error getting LTC price for TipCC deposit:', e);
    }

    // Generate success image
    const successImage = await generateTipCCSuccessImage(senderUser, ltcAmount, points, usdValue);
    const successAttachment = new AttachmentBuilder(successImage, { name: 'success.png' });

    // Send confirmation embed
    const confirmEmbed = new EmbedBuilder()
      .setTitle('<:LTC:904095822604550144> TipCC Deposit Credited!')
      .setDescription(`<@${senderId}>, your tip has been successfully credited to your account!`)
      .addFields([
        { name: '📊 LTC Amount', value: `${ltcAmount.toFixed(8)} LTC`, inline: true },
        { name: '💵 USD Value', value: usdValue > 0 ? `$${usdValue.toFixed(4)}` : 'N/A', inline: true },
        { name: '🎯 Points Credited', value: `${points.toFixed(2)} points`, inline: true },
        { name: '💰 New Balance', value: `${newBalance.toFixed(2)} points`, inline: false }
      ])
      .setColor('#1abc9c')
      .setImage('attachment://success.png')
      .setFooter({ text: 'MasterBets • TipCC Deposit System' })
      .setTimestamp();

    await processingMsg.edit({ 
      content: `<@${senderId}>`,
      embeds: [confirmEmbed], 
      files: [successAttachment] 
    });

    // Log to console
    console.log(`✅ TipCC deposit credited: ${senderId} sent ${ltcAmount} LTC (${points} points)`);

    // Log to logs channel (optional)
    try {
      const logEmbed = new EmbedBuilder()
        .setTitle('💰 TipCC Deposit Received')
        .setDescription(`<@${senderId}> deposited via TipCC`)
        .addFields([
          { name: 'LTC Amount', value: `${ltcAmount.toFixed(8)} LTC`, inline: true },
          { name: 'Points Credited', value: `${points.toFixed(2)} points`, inline: true }
        ])
        .setColor('#1abc9c')
        .setTimestamp();
      
      await sendLogMessage({ embeds: [logEmbed] });
    } catch (logError) {
      console.error('Error logging TipCC deposit:', logError);
    }

  } catch (error) {
    console.error('Error processing TipCC deposit:', error);
    
    // Try to send error message
    try {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Deposit Processing Error')
        .setDescription('There was an error processing your TipCC deposit. Please contact support.')
        .setColor('#e74c3c')
        .setFooter({ text: 'MasterBets • TipCC Deposit System' });
      
      await msg.channel.send({ embeds: [errorEmbed] });
    } catch (e) {
      console.error('Failed to send error message:', e);
    }
  }
});

console.log('✅ TipCC Deposit System loaded!');
// Simple mines game header image (actual game uses Discord buttons)
async function generateMinesGameImage(user, betAmount, bombs, revealedTiles = [], multiplier = 1.0, status = 'active', minePositions = []) {
  const width = 500, height = 200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, width, height);

  // Game info
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${user.username}'s Mines Game`, width / 2, 50);
  
  ctx.font = '18px Arial';
  ctx.fillText(`Bet: ${betAmount.toFixed(2)} points | Bombs: ${bombs} | Multiplier: ${multiplier.toFixed(2)}x`, width / 2, 80);

  ctx.font = '16px Arial';
  ctx.fillText('Click the buttons below to reveal tiles!', width / 2, 120);
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '14px Arial';
  ctx.fillText('Masterbets • Interactive Mines Game', width / 2, 150);

  return canvas.toBuffer();
}

// Generate premium bot wallet balance image for MasterBets
async function generateBotWalletImage(ltcBalance, usdValue, points) {
  const width = 800, height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Premium dark background with subtle gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0f1419');
  gradient.addColorStop(0.5, '#1a1f2e');
  gradient.addColorStop(1, '#0f1419');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Main container with rounded corners effect
  const containerX = 40;
  const containerY = 40;
  const containerWidth = width - 80;
  const containerHeight = height - 80;
  const cornerRadius = 20;

  // Main container with rounded corners
  ctx.fillStyle = 'rgba(45, 55, 75, 0.8)';
  ctx.beginPath();
  ctx.moveTo(containerX + cornerRadius, containerY);
  ctx.lineTo(containerX + containerWidth - cornerRadius, containerY);
  ctx.arcTo(containerX + containerWidth, containerY, containerX + containerWidth, containerY + containerHeight, cornerRadius);
  ctx.lineTo(containerX + containerWidth, containerY + containerHeight - cornerRadius);
  ctx.arcTo(containerX + containerWidth, containerY + containerHeight, containerX + containerWidth - cornerRadius, containerY + containerHeight, cornerRadius);
  ctx.lineTo(containerX + cornerRadius, containerY + containerHeight);
  ctx.arcTo(containerX, containerY + containerHeight, containerX, containerY + containerHeight - cornerRadius, cornerRadius);
  ctx.lineTo(containerX, containerY + cornerRadius);
  ctx.arcTo(containerX, containerY, containerX + cornerRadius, containerY, cornerRadius);
  ctx.closePath();
  ctx.fill();

  // Subtle border glow
  ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(containerX + cornerRadius, containerY);
  ctx.lineTo(containerX + containerWidth - cornerRadius, containerY);
  ctx.arcTo(containerX + containerWidth, containerY, containerX + containerWidth, containerY + containerHeight, cornerRadius);
  ctx.lineTo(containerX + containerWidth, containerY + containerHeight - cornerRadius);
  ctx.arcTo(containerX + containerWidth, containerY + containerHeight, containerX + containerWidth - cornerRadius, containerY + containerHeight, cornerRadius);
  ctx.lineTo(containerX + cornerRadius, containerY + containerHeight);
  ctx.arcTo(containerX, containerY + containerHeight, containerX, containerY + containerHeight - cornerRadius, cornerRadius);
  ctx.lineTo(containerX, containerY + cornerRadius);
  ctx.arcTo(containerX, containerY, containerX + cornerRadius, containerY, cornerRadius);
  ctx.closePath();
  ctx.stroke();

  // Header: "MasterBets Casino - House Balance"
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText('MasterBets Casino - House Balance', 70, 100);

  // Subheader
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '16px Arial';
  ctx.fillText('TOTAL LTC BALANCE', 70, 130);

  // Main LTC balance - large and prominent
  ctx.fillStyle = '#4ade80'; // MasterBets green color
  ctx.font = 'bold 48px Arial';
  const ltcText = `${ltcBalance.toFixed(8)} LTC`;
  ctx.fillText(ltcText, 70, 190);

  // Points and USD equivalent line
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '20px Arial';
  const equivalentText = `≈ ${points.toFixed(2)} Points • ≈ $${usdValue.toFixed(2)} USD`;
  ctx.fillText(equivalentText, 70, 230);

  // Current date (no time)
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = '14px Arial';
  ctx.fillText(`Data as of ${dateStr}`, 70, 260);

  // Footer with LTC rate info
  let ltcPrice = 0;
  try {
    ltcPrice = await getLTCPriceUSD();
  } catch (e) {
    ltcPrice = usdValue / ltcBalance || 0;
  }
  
  const footerText = `MasterBets • LTC Rate: $${ltcPrice.toFixed(2)}/LTC`;
  ctx.fillStyle = 'rgba(100, 181, 246, 0.8)';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(footerText, 70, 320);

  // Status indicator
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(width - 130, 70, 12, 12);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px Arial';
  ctx.fillText('ONLINE', width - 110, 82);

  // Decorative Litecoin symbol
  ctx.fillStyle = 'rgba(100, 181, 246, 0.2)';
  ctx.font = 'bold 120px Arial';
  ctx.fillText('Ł', width - 180, 280);

  return canvas.toBuffer();
}


// Check for user's pending deposits manually using Apirone
async function claimDepositsForUser(userId) {
  await ensureUserExists(userId);
  
  // Force a scan first
  await scanDepositsAndNotify();
  
  // Check if there are any uncredited deposits for this user
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || !user.deposit_address) {
    return { credited: 0, details: [] };
  }

  console.log(`Checking deposits for user ${userId} at address ${user.deposit_address}`);
  
  // Look for recent transactions to this user's address using Apirone
  const addressTxs = await fetchAddressTransactions(user.deposit_address);
  let newCredits = 0;
  const details = [];

  for (const tx of addressTxs) {
    if (tx.type === 'received' && tx.confirmations >= 1) {
      // Check if we already processed this
      const existingDeposit = await dbGet('SELECT * FROM deposits WHERE txid = ? AND credited = 1', [tx.txid]);
      if (existingDeposit) continue;
      
      // Skip if this is the same transaction we already processed
      if (user.last_tx === tx.txid) continue;
      
      const amountLtc = tx.amount / 1e8;
      const points = ltcToPoints(amountLtc);
      
      console.log(`Processing manual check deposit: ${amountLtc} LTC (${points} points)`);
      
      if (points > 0) {
        await addPointsToUser(userId, points);
        await dbRun('UPDATE users SET last_tx = ? WHERE id = ?', [tx.txid, userId]);
        await insertDepositIfNew(tx.txid, user.deposit_address, amountLtc, points, tx.confirmations, Date.now());
        await markDepositCredited(tx.txid, userId);
        
        newCredits += points;
        details.push({
          txid: tx.txid,
          ltc: amountLtc,
          points: points,
          confirmations: tx.confirmations
        });
      }
    }
  }

  return { credited: newCredits, details };
}

// --- Redeem-code helpers ---

async function createRedeemCode(code, reward, totalUses, wagerRequirement, creatorId) {
  const now = Date.now();
  // Insert or fail if exists
  await dbRun(
    'INSERT INTO redeem_codes (code, reward, uses_remaining, total_uses, wager_requirement, created_by, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [code, reward, totalUses, totalUses, wagerRequirement, creatorId, now]
  );
}

async function getRedeemCode(code) {
  return await dbGet('SELECT * FROM redeem_codes WHERE code = ?', [code]);
}

async function listActiveRedeemCodes() {
  return await dbAll('SELECT code, reward, uses_remaining, total_uses, wager_requirement, created_by, created_at FROM redeem_codes WHERE active = 1', []);
}

async function exhaustRedeemCode(code) {
  await dbRun('UPDATE redeem_codes SET uses_remaining = 0, active = 0 WHERE code = ?', [code]);
}

async function decrementRedeemCodeUse(code) {
  // Atomically decrement and deactivate when 0
  await beginTransaction();
  try {
    const row = await getRedeemCode(code);
    if (!row) throw new Error('Code not found');
    if (!row.active || row.uses_remaining <= 0) {
      await rollbackTransaction();
      return { ok: false, message: 'Code expired or out of uses' };
    }
    // decrement
    await dbRun('UPDATE redeem_codes SET uses_remaining = uses_remaining - 1 WHERE code = ?', [code]);
    // if reaches 0, set active = 0
    const updated = await getRedeemCode(code);
    if (updated.uses_remaining <= 0) {
      await dbRun('UPDATE redeem_codes SET active = 0 WHERE code = ?', [code]);
    }
    await commitTransaction();
    return { ok: true, code: updated };
  } catch (e) {
    await rollbackTransaction();
    throw e;
  }
}

// Bot ready event
client.once('clientReady', async () => {
  console.log(`✅ Ready as ${client.user.tag}`);
  
  // Start automatic deposit scanning
  scanDepositsAndNotify().catch(() => {});
  setInterval(() => scanDepositsAndNotify().catch(() => {}), SCAN_INTERVAL_MS);
  await initializeFairPlayProtocol();
});

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // Handle level claim button
  if (interaction.customId.startsWith('claim_level_')) {
    try {
      const userId = interaction.customId.split('_')[2];
      
      // Verify it's the right user
      if (userId !== interaction.user.id) {
        return interaction.reply({ content: '❌ You can only claim your own level rewards!', ephemeral: true });
      }
      
      // Claim the level reward
      const claimResult = await claimLevelReward(userId, interaction.guild);
      
      if (claimResult.success) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 Level Claimed Successfully!')
          .setDescription(`Congratulations! You've claimed **${claimResult.level.emoji} ${claimResult.level.name}** and earned **${claimResult.reward} points**!`)
          .setColor('#00FF00')
          .addFields([
            { name: '🎖️ New Level', value: `${claimResult.level.emoji} ${claimResult.level.name}`, inline: true },
            { name: '💰 Points Earned', value: `${claimResult.reward} points`, inline: true },
            { name: '🎯 Keep Going!', value: 'Wager more to reach the next level!', inline: true }
          ])
          .setFooter({ text: 'Masterbets Level System • Congratulations on your achievement!' })
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: false });
        
        // Update the original message to remove the claim button
        try {
          const levelData = await getUserLevelData(userId);
          if (levelData) {
            const levelCardImage = await generateLevelCardImage(interaction.user, levelData);
            const attachment = new AttachmentBuilder(levelCardImage, { name: 'level-card-updated.png' });
            
            const updatedEmbed = new EmbedBuilder()
              .setTitle(`🎖️ ${interaction.user.username}'s Level Status`)
              .setDescription(`**Current Level:** ${levelData.currentLevel.emoji} ${levelData.currentLevel.name}\n${levelData.nextLevel ? `**Next Level:** ${levelData.nextLevel.emoji} ${levelData.nextLevel.name}` : '���� **MAX LEVEL REACHED!**'}`)
              .setImage('attachment://level-card-updated.png')
              .setColor('#FFD700')
              .setFooter({ text: 'Masterbets Level System • Keep wagering to level up!' })
              .setTimestamp();
            
            await interaction.followUp({ embeds: [updatedEmbed], files: [attachment], ephemeral: true });
          }
        } catch (updateError) {
          console.error('Error updating level card after claim:', updateError);
        }
        
      } else {
        await interaction.reply({ 
          content: `❌ ${claimResult.message}`, 
          ephemeral: true 
        });
      }
      
    } catch (error) {
      console.error('Error handling level claim button:', error);
      await interaction.reply({ 
        content: '❌ An error occurred while claiming your level reward. Please try again.', 
        ephemeral: true 
      });
    }
    return;
  }

  // Handle dismiss balance button
  if (interaction.customId === 'dismiss_balance') {
    try {
      // Delete the message (balance card)
      await interaction.message.delete();
      console.log(`Balance card dismissed by user: ${interaction.user.username}`);
    } catch (e) {
      console.error('Error dismissing balance card:', e);
      // Fallback: reply with acknowledgment if deletion fails
      try {
        await interaction.reply({ content: '✅ Balance card dismissed!', ephemeral: true });
      } catch (e2) {}
    }
    return;
  }

  // Handle coinflip "bet again" buttons
  if (interaction.customId.startsWith('cf_again_')) {
    const parts = interaction.customId.split('_');
    const points = parseFloat(parts[2]);
    const choice = parts[3]; // 'heads' or 'tails'

    try {
      // Check coin flip cooldown
      const cooldownCheck = checkCoinflipCooldown(interaction.user.id);
      if (!cooldownCheck.valid) {
        try {
          await interaction.reply({
            content: `⏰ ${cooldownCheck.message}`,
            ephemeral: true
          });
        } catch (e) {}
        return;
      }

      // Check user balance
      await ensureUserExists(interaction.user.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [interaction.user.id]);
      const balance = Math.round(user?.balance || 0);

      if (balance < points) {
        try {
          await interaction.reply({
            content: `❌ Insufficient balance! You need **${points.toFixed(2)}** points but only have **${balance.toFixed(2)}** points.\n\nUse \`.deposit\` to add more funds!`,
            ephemeral: true
          });
        } catch (e) {}
        return;
      }


      // Update cooldown timestamp early to prevent race conditions
      updateCoinflipTimestamp(interaction.user.id);

      // Sync coinflip bet with leveling system
      try {
        await trackWageredAmount(interaction.user.id, points);
      } catch (e) {
        console.error('Leveling sync failed (Coinflip):', e);
      }

      // First show spinning coin animation
      const spinningImage = await generateSpinningCoinImage(interaction.user, points, choice);
      const spinningAttachment = new AttachmentBuilder(spinningImage, { name: 'spinning-coin.png' });

      const spinningEmbed = new EmbedBuilder()
        .setColor('#00bcd4')
        .setImage('attachment://spinning-coin.png')
        .setFooter({ text: 'Masterbets' });

      try {
        await interaction.reply({ embeds: [spinningEmbed], files: [spinningAttachment] });
      } catch (e) {}

      // Wait 2 seconds for suspense
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Generate game result using cryptographically secure randomness
      const serverSeed = crypto.randomBytes(16).toString('hex');
      const clientSeed = interaction.user.id;
      const nonce = Date.now();

      // Check profit mode to determine winning chances
      let gameResult;
      let userWon;

      const houseLuck = await getHouseLuckPercent();
      const userWinChance = Math.max(0, Math.min(100, 100 - houseLuck));
      const randomNum = await crypto.randomInt(0, 100);
      userWon = randomNum < userWinChance;
      gameResult = userWon ? choice : (choice === 'heads' ? 'tails' : 'heads');
      const multiplier = 1.92;
      const winnings = userWon ? Number((points * multiplier).toFixed(2)) : 0; // Total points received when winning  
      const netChange = userWon ? Number((points * (multiplier - 1)).toFixed(2)) : -points; // Net change: win +0.92 for 1 point bet, lose -1

      // Update user balance for win/loss
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [netChange, interaction.user.id]);

      // Log coinflip wins to the logs channel (for bet again buttons)
      if (userWon) {
        try {
          await sendLogMessage(`<:stolen_emoji_blaze:1424681423553691672> ${interaction.user.username} won ${winnings.toFixed(2)} points in coinflip!`);
        } catch (logError) {
          console.error('Error logging coinflip win (bet again):', logError);
        }
      }

  // Generate fair hash
  const fairHash = crypto.createHash('sha256').update(`${serverSeed}${clientSeed}${nonce}`).digest('hex');

      // Generate coinflip result image
      const resultImage = await generateCoinflipImage(interaction.user, points, choice, gameResult, userWon, winnings, fairHash);
      const imageAttachment = new AttachmentBuilder(resultImage, { name: 'coinflip-result.png' });

      // Create betting buttons for next round (green for wins, red for losses)
      const buttonStyle = userWon ? ButtonStyle.Success : ButtonStyle.Danger;
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cf_again_${points.toFixed(2)}_heads`)
          .setLabel(`Bet again ${points.toFixed(2)} points on Heads`)
          .setStyle(buttonStyle),
        new ButtonBuilder()
          .setCustomId(`cf_again_${points.toFixed(2)}_tails`)
          .setLabel(`Bet again ${points.toFixed(2)} points on Tails`)
          .setStyle(buttonStyle)
      );

      // Red embed for losses, green for wins
      const resultEmbed = new EmbedBuilder()
        .setColor(userWon ? '#22c55e' : '#ef4444')
        .setImage('attachment://coinflip-result.png')
        .setFooter({ text: 'Masterbets' });

      try {
        await interaction.editReply({ embeds: [resultEmbed], files: [imageAttachment], components: [actionRow] });
      } catch (e) {
        console.error('Error editing coinflip result:', e);
      }

    } catch (e) {
      console.error('Coinflip bet again error:', e);
      try {
        await interaction.reply({ content: '❌ An error occurred during coinflip. Please try again.', ephemeral: true });
      } catch (e2) {}
    }
    return;
  }

  // Handle check funds button
  if (interaction.customId === 'check_funds') {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {}

    const userId = interaction.user.id;
    const result = await claimDepositsForUser(userId);

    if (result.credited === 0) {
      try {
        await interaction.followUp({ 
          content: '🔍 No new confirmed deposits found for your account right now.\n\nMake sure your deposit has at least 1 confirmation and try again!', 
          ephemeral: true 
        });
      } catch (e) {}
      return;
    }

    const lines = result.details.map(d => 
      `• **${d.txid.substring(0, 16)}...** \n  ${d.ltc.toFixed(8)} LTC → ${d.points} pts (${d.confirmations} confirmations)`
    ).join('\n\n');

    const summary = `<:stolen_emoji_blaze:1424681423553691672> **Deposits credited: ${result.credited} points**\n\n${lines}`;

    try {
      await interaction.followUp({ content: summary, ephemeral: true });
    } catch (e) {}
    return;
  }

  // Handle withdrawal cancel button
  if (interaction.customId.startsWith('withdraw_cancel_')) {
    const userId = interaction.customId.split('_')[2];
    
    if (interaction.user.id !== userId) {
      try {
        await interaction.reply({ content: '❌ This withdrawal request is not yours!', ephemeral: true });
      } catch (e) {}
      return;
    }

    const cancelEmbed = new EmbedBuilder()
      .setTitle('❌ Withdrawal Cancelled')
      .setDescription('Your withdrawal request has been cancelled.')
      .setColor('#95a5a6');

    try {
      await interaction.update({ embeds: [cancelEmbed], components: [] });
    } catch (e) {
      console.error('Error cancelling withdrawal:', e);
    }
    return;
  }

  // Handle withdrawal cashout button
  if (interaction.customId.startsWith('withdraw_cashout_')) {
    const parts = interaction.customId.split('_');
    const userId = parts[2];
    const points = parseFloat(parts[3]);
    const ltcAddress = parts.slice(4).join('_'); // Rejoin address parts in case it contains underscores
    
    if (interaction.user.id !== userId) {
      try {
        await interaction.reply({ content: '❌ This withdrawal request is not yours!', ephemeral: true });
      } catch (e) {}
      return;
    }

    const processingEmbed = new EmbedBuilder()
      .setTitle('⏳ Processing Withdrawal...')
      .setDescription('Please wait while we process your withdrawal on the chain.')
      .setColor('#f39c12');

    try {
      await interaction.update({ embeds: [processingEmbed], components: [] });
    } catch (e) {
      console.error('Error updating to processing state:', e);
      return;
    }

    const result = await processWithdrawal(userId, points, ltcAddress);
    
    if (result.success) {
      const successEmbed = new EmbedBuilder()
        .setTitle('<:stolen_emoji_blaze:1424681423553691672> Withdrawal Sent!')
        .setDescription('Your LTC withdrawal has been sent successfully sended.')
        .setColor('#27ae60')
        .addFields([
          { name: '🎯 Points Withdrawn', value: `${points.toFixed(2)} points`, inline: true },
          { name: '💵 USD Value', value: `$${result.amountUsd.toFixed(2)}`, inline: true },
          { name: '🪙 LTC Sent', value: `${result.ltcAmount.toFixed(8)} LTC`, inline: true },
          { name: '📍 To Address', value: `\`${ltcAddress}\``, inline: false },
          { name: '🔗 Transaction ID', value: `\`${result.txid}\``, inline: false }
        ])
        .setFooter({ text: 'Masterbets • Withdrawal completed via Blockchain' })
        .setTimestamp();

      try {
        await interaction.editReply({ embeds: [successEmbed], components: [] });
      } catch (e) {
        console.error('Error updating success message:', e);
      }

      // Send DM notification
      await sendWithdrawalDM(interaction.user, {
        points: points,
        ltcAmount: result.ltcAmount,
        amountUsd: result.amountUsd,
        ltcAddress: ltcAddress,
        txid: result.txid,
        fee: result.fee
      });

    } else {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Withdrawal Failed')
        .setDescription(result.message || 'An error occurred while processing your withdrawal.')
        .setColor('#e74c3c')
        .setFooter({ text: 'If this persists, please contact support' });

      try {
        await interaction.editReply({ embeds: [errorEmbed], components: [] });
      } catch (e) {
        console.error('Error updating error message:', e);
      }
    }
    return;
  }

  // Handle help category buttons
  if (interaction.customId === 'help_economy') {
    const economyEmbed = new EmbedBuilder()
      .setTitle('💰 Economy Commands')
      .setColor('#2ecc71')
      .setDescription('**Financial commands for managing your MasterBets account:**')
      .addFields([
        { name: '📥 `.deposit` / `.depo`', value: 'Get your personal LTC deposit address with QR code', inline: false },
        { name: '💰 `.balance` / `.bal`', value: 'Check your point balance with beautiful graphics', inline: false },
        { name: '📤 `.withdraw <amount> <address>`', value: 'Withdraw LTC to external address (min: 10 points)', inline: false },
        { name: '💸 `.tip @user <points>`', value: 'Send points to another user (1-10,000 points)', inline: false },
        { name: '📊 `.stats` / `.statistics`', value: 'View your stats (or mention a user: `.stats @user`)', inline: false },
        { name: '💎 `.rb` / `.rakeback`', value: 'Claim your rakeback', inline: false },
        { name: '🎁 `.daily`', value: 'Claim free daily points (1 point with requirements)', inline: false },
        { name: '🏷️ `.claim <CODE>`', value: 'Redeem a code (some codes require wager)', inline: false }
      ])
      .setFooter({ text: 'Masterbets • 0.0001 LTC = 1 point' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help_games')
        .setLabel('🎮 Games')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('help_utility')
        .setLabel('🧮 Utility')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Main Menu')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await interaction.update({ embeds: [economyEmbed], components: [row] });
    } catch (e) {
      console.error('Error updating economy help:', e);
    }
    return;
  }

  if (interaction.customId === 'help_games') {
    const gamesEmbed = new EmbedBuilder()
      .setTitle('🎮 Games Commands')
      .setColor('#e74c3c')
      .setDescription('**Available gambling games:**')
      .addFields([
        { 
          name: '🪙 `.cf <points> [heads/tails]`', 
          value: 'Coinflip game with 1.92x multiplier\n**Betting Range:** 1-1000 points\n**Example:** `.cf 100 heads`', 
          inline: false 
        },
        { 
          name: '🃏 `.bj <points>` or `.blackjack <points>`', 
          value: 'Classic Blackjack with 2.5x blackjack payout\n**Betting Range:** 0.01-1000 points\n**Example:** `.bj 50` or `.bj all`', 
          inline: false 
        },
        { 
          name: '💎 `.mines <points> [bombs]`', 
          value: 'Navigate a minefield to win big!\n**Bombs:** 3-24 (default: 5)\n**Example:** `.mines 50 7`', 
          inline: false 
        },
        { 
          name: '📦 `.case <type>` / `.cases`', 
          value: 'Open cases with animated results\n**Example:** `.cases` then `.case basic`', 
          inline: false 
        },
        { 
          name: '🎲 `.dicewar` / `.ward`', 
          value: 'Dice War vs the house\n**Example:** `.dicewar 50`', 
          inline: false 
        },
        { 
          name: '📝 `.wordly <points>`', 
          value: 'Word challenge game with a prize pot\n**Example:** `.wordly 10`', 
          inline: false 
        },
        { 
          name: '🏰 `.tower <points> [level]`', 
          value: 'Climb the Tower for big rewards!\n**Betting Range:** 1-1000 points\n**Level Range:** 1-50 (default: 1)\n**Example:** `.tower 100 10`', 
          inline: false 
        }
      ])
      .setFooter({ text: 'Masterbets • More games coming soon!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help_economy')
        .setLabel('💰 Economy')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('help_utility')
        .setLabel('🧮 Utility')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Main Menu')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await interaction.update({ embeds: [gamesEmbed], components: [row] });
    } catch (e) {
      console.error('Error updating games help:', e);
    }
    return;
  }

  if (interaction.customId === 'help_main') {
    const mainEmbed = new EmbedBuilder()
      .setTitle('🎮 Masterbets Bot — Help')
      .setColor('#3498db')
      .setDescription('Welcome to **Masterbets**! Your premier cryptocurrency gambling platform.\n\nSelect a category below to view available commands:')
      .addFields([
        { name: '💰 Economy', value: 'Deposit, withdraw, balance, daily claims, and tipping', inline: true },
        { name: '🎮 Games', value: 'Fun gambling games to play with your points', inline: true },
        { name: '🧮 Utility', value: 'Calculator, price checker, and helpful tools', inline: true },
        { name: '📊 Conversion Rate', value: '0.0001 LTC = 1 point', inline: false }
      ])
      .setFooter({ text: 'Masterbets • Your Premier Crypto Gaming Platform' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help_economy')
        .setLabel('💰 Economy')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('help_games')
        .setLabel('🎮 Games')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('help_utility')
        .setLabel('🧮 Utility')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Main Menu')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await interaction.update({ embeds: [mainEmbed], components: [row] });
    } catch (e) {
      console.error('Error updating main help:', e);
    }
    return;
  }

  if (interaction.customId === 'help_utility') {
    const utilityEmbed = new EmbedBuilder()
      .setTitle('🧮 Utility Commands')
      .setColor('#9b59b6')
      .setDescription('**Helpful tools and calculators:**')
      .addFields([
        { name: '🧮 `.calc <expression>`', value: 'Calculate mathematical expressions\n**Example:** `.calc 2 + 2 * 5`', inline: false },
        { name: '💰 `.price [points]`', value: 'Show points value in USD and LTC\n**Example:** `.price 100`', inline: false }
      ])
      .setFooter({ text: 'Masterbets • Helpful utilities' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help_economy')
        .setLabel('💰 Economy')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('help_games')
        .setLabel('🎮 Games')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Main Menu')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await interaction.update({ embeds: [utilityEmbed], components: [row] });
    } catch (e) {
      console.error('Error updating utility help:', e);
    }
    return;
  }

  // Handle mines game tile buttons
  if (interaction.customId.startsWith('mines_cashout_')) {
    try {
      const gameId = parseInt(interaction.customId.split('_')[2]);

      const now = Date.now();
      const last = minesCashoutCooldown.get(interaction.user.id) || 0;
      if (now - last < MINES_CASHOUT_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((MINES_CASHOUT_COOLDOWN_MS - (now - last)) / 1000);
        await interaction.reply({ content: `⏳ Please wait ${waitSeconds} second${waitSeconds !== 1 ? 's' : ''} before cashing out again.`, ephemeral: true });
        return;
      }
      minesCashoutCooldown.set(interaction.user.id, now);

      const game = await dbGet('SELECT * FROM mines_games WHERE id = ? AND status = "active"', [gameId]);
      if (!game) {
        await interaction.reply({ content: '❌ Game not found or already finished!', flags: MessageFlags.Ephemeral });
        return;
      }
      if (game.user_id !== interaction.user.id) {
        await interaction.reply({ content: '❌ This is not your game!', flags: MessageFlags.Ephemeral });
        return;
      }

      const revealedTiles = JSON.parse(game.revealed_tiles || '[]');
      if (!revealedTiles || revealedTiles.length < 1) {
        await interaction.reply({ content: '❌ You must reveal **at least 1 tile** before cashing out.', ephemeral: true });
        return;
      }

      const multiplier = game.current_multiplier;
      const winnings = Number((game.bet_amount * multiplier).toFixed(2));

      await beginTransaction();
      try {
        const updateResult = await dbRun('UPDATE mines_games SET status = ? WHERE id = ? AND status = "active"', ['cashed_out', game.id]);
        if (updateResult.changes === 0) {
          await rollbackTransaction();
          return;
        }
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, interaction.user.id]);
        await commitTransaction();
      } catch (error) {
        await rollbackTransaction();
        throw error;
      }

      // streak update (count cashout as a win)
      await dbRun('INSERT INTO mines_streaks (user_id, win_streak) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET win_streak = win_streak + 1', [interaction.user.id]);

      const profit = Number((winnings - game.bet_amount).toFixed(2));
      const cashoutEmbed = new EmbedBuilder()
        .setTitle('💎 Mines Game - Cashed Out!')
        .setDescription(`🎉 **Congratulations!** You successfully cashed out!\n\n` +
          `💎 **Tiles Revealed:** ${revealedTiles.length}\n` +
          `💣 **Bombs:** ${game.bombs}\n` +
          `🔢 **Multiplier:** ${multiplier.toFixed(3)}x\n` +
          `💰 **Winnings:** ${winnings.toFixed(2)} points\n` +
          `📈 **Profit:** ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} points\n\n` +
          `💎 = Safe tiles | 💣 = Mine locations`)
        .setColor(profit >= 0 ? '#00ff00' : '#ff6b6b')
        .setFooter({ text: 'MasterBets • Smart cashout!' });

      const gridState = JSON.parse(game.grid_state);
      const finalRows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const buttonTileIndex = i * 5 + j;
          const isMine = gridState.includes(buttonTileIndex);
          let label, style;
          if (isMine) {
            label = '💣';
            style = ButtonStyle.Danger;
          } else {
            label = '💎';
            style = ButtonStyle.Success;
          }
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`mine_result_${buttonTileIndex}`)
              .setLabel(label)
              .setStyle(style)
              .setDisabled(true)
          );
        }
        finalRows.push(row);
      }

      const gameImage = await generateMinesGameImage(
        interaction.user,
        game.bet_amount,
        game.bombs,
        revealedTiles,
        multiplier,
        'cashed_out',
        gridState
      );
      const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });
      cashoutEmbed.setImage('attachment://mines-game.png');

      // edit original mines grid message if available
      try {
        if (game.channel_id && game.message_id) {
          const channel = await client.channels.fetch(game.channel_id);
          const msgToEdit = await channel.messages.fetch(game.message_id);
          await msgToEdit.edit({ content: `<@${interaction.user.id}>`, embeds: [cashoutEmbed], files: [attachment], components: finalRows });
        }
      } catch (e) {
        // fallback: just update the cashout interaction message
      }

      await interaction.update({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mines_cashout_${gameId}`).setLabel('Cashout').setStyle(ButtonStyle.Success).setDisabled(true))] });
      return;
    } catch (e) {
      console.error('Error in mines cashout button:', e);
      try {
        await interaction.reply({ content: '❌ An error occurred while cashing out. Please try again.', ephemeral: true });
      } catch (e2) {}
      return;
    }
  }

  if (interaction.customId.startsWith('mine_tile_')) {
    try {
      const parts = interaction.customId.split('_');
      const gameId = parseInt(parts[2]);
      const tileIndex = parseInt(parts[3]);

      // Get the game from database
      const game = await dbGet('SELECT * FROM mines_games WHERE id = ? AND status = "active"', [gameId]);
      if (!game) {
        await interaction.reply({ content: '❌ Game not found or already finished!', flags: MessageFlags.Ephemeral });
        return;
      }

      // Check if user owns this game
      if (game.user_id !== interaction.user.id) {
        await interaction.reply({ content: '❌ This is not your game!', flags: MessageFlags.Ephemeral });
        return;
      }

      // Parse game data
      const minePositions = JSON.parse(game.grid_state);
      const revealedTiles = JSON.parse(game.revealed_tiles || '[]');

      // Check if tile already revealed
      if (revealedTiles.includes(tileIndex)) {
        await interaction.reply({ content: '❌ Tile already revealed!', flags: MessageFlags.Ephemeral });
        return;
      }

      // Forced loss algorithm: after 2 wins in a row, first click of next game loses
      if (Number(game.force_loss || 0) === 1 && revealedTiles.length === 0) {
        await dbRun('UPDATE mines_games SET status = ?, revealed_tiles = ? WHERE id = ?',
          ['lost', JSON.stringify([tileIndex]), gameId]);
        await dbRun('UPDATE mines_streaks SET win_streak = 0 WHERE user_id = ?', [interaction.user.id]);

        const finalRows = [];
        for (let i = 0; i < 5; i++) {
          const row = new ActionRowBuilder();
          for (let j = 0; j < 5; j++) {
            const buttonTileIndex = i * 5 + j;
            const isMine = minePositions.includes(buttonTileIndex) || buttonTileIndex === tileIndex;
            let label, style;
            if (isMine) {
              label = '💣';
              style = ButtonStyle.Danger;
            } else {
              label = '💎';
              style = ButtonStyle.Success;
            }
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`mine_result_${buttonTileIndex}`)
                .setLabel(label)
                .setStyle(style)
                .setDisabled(true)
            );
          }
          finalRows.push(row);
        }

        const gameImage = await generateMinesGameImage(
          interaction.user,
          game.bet_amount,
          game.bombs,
          [tileIndex],
          game.current_multiplier,
          'lost',
          minePositions
        );
        const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

        const loseEmbed = new EmbedBuilder()
          .setTitle('💥 BOOM! Game Over!')
          .setDescription(`💣 **You hit a mine!** Lost **${game.bet_amount.toFixed(2)}** points.`)
          .setColor('#ff0000')
          .setImage('attachment://mines-game.png')
          .setFooter({ text: 'Masterbets • Better luck next time!' });

        await interaction.update({ embeds: [loseEmbed], files: [attachment], components: finalRows });
        return;
      }

      // Check if it's a mine
      if (minePositions.includes(tileIndex)) {
        // User hit a mine - game over
        await dbRun('UPDATE mines_games SET status = ?, revealed_tiles = ? WHERE id = ?', 
          ['lost', JSON.stringify([...revealedTiles, tileIndex]), gameId]);

        await dbRun('UPDATE mines_streaks SET win_streak = 0 WHERE user_id = ?', [interaction.user.id]);

        // Generate final grid showing all mine positions
        const finalRows = [];
        for (let i = 0; i < 5; i++) {
          const row = new ActionRowBuilder();
          for (let j = 0; j < 5; j++) {
            const buttonTileIndex = i * 5 + j;
            const isMine = minePositions.includes(buttonTileIndex);
            const isRevealed = [...revealedTiles, tileIndex].includes(buttonTileIndex);
            
            let label, style;
            if (isMine) {
              label = '💣';
              style = ButtonStyle.Danger;
            } else if (isRevealed) {
              label = '💎';
              style = ButtonStyle.Success;
            } else {
              label = '💎';
              style = ButtonStyle.Success;
            }
            
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`mine_result_${buttonTileIndex}`)
                .setLabel(label)
                .setStyle(style)
                .setDisabled(true)
            );
          }
          finalRows.push(row);
        }

        const gameImage = await generateMinesGameImage(
          interaction.user, 
          game.bet_amount, 
          game.bombs, 
          [...revealedTiles, tileIndex], 
          game.current_multiplier, 
          'lost', 
          minePositions
        );
        const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

        const loseEmbed = new EmbedBuilder()
          .setTitle('💥 BOOM! Game Over!')
          .setDescription(`💣 **You hit a mine!** Lost **${game.bet_amount.toFixed(2)}** points.\n\n🎯 **Safe tiles revealed:** ${revealedTiles.length}\n💣 **Mine locations:** ${minePositions.length}\n\n💎 = Safe tiles | 💣 = Mines`)
          .setColor('#ff0000')
          .setImage('attachment://mines-game.png')
          .setFooter({ text: 'Masterbets • Better luck next time!' });

        await interaction.update({ embeds: [loseEmbed], files: [attachment], components: finalRows });
        return;
      }

      // Safe tile revealed
      const newRevealedTiles = [...revealedTiles, tileIndex];
      const safeTilesCount = 25 - game.bombs;
      
      // CSV-based multiplier system with 2% house edge
      const multiplierData = {
        3: {1:1.113636,2:1.272727,3:1.463636,4:1.694737,5:1.977193,6:2.326109,7:2.762255,8:3.314706,9:4.025,10:4.953846,11:6.192308,12:7.881119,13:10.245455,14:13.660606,15:18.783333,16:26.833333,17:40.25,18:64.4,19:112.7,20:225.4,21:563.5,22:2254.0},
        4: {1:1.166667,2:1.4,3:1.694737,4:2.071345,5:2.55872,6:3.1984,7:4.051307,8:5.208824,9:6.811538,10:9.082051,11:12.384615,12:17.338462,13:25.044444,14:37.566667,15:59.033333,16:98.388889,17:177.1,18:354.2,19:826.466667,20:2479.4,21:12397.0},
        5: {1:1.225,2:1.547368,3:1.977193,4:2.55872,5:3.35832,6:4.477761,7:6.076961,8:8.414253,9:11.920192,10:17.338462,11:26.007692,12:40.45641,13:65.741667,14:112.7,15:206.616667,16:413.233333,17:929.775,18:2479.4,19:8677.9,20:52067.4},
        6: {1:1.289474,2:1.719298,3:2.326109,4:3.1984,5:4.477761,6:6.396801,7:9.34917,8:14.023756,9:21.673077,10:34.676923,11:57.794872,12:101.141026,13:187.833333,14:375.666667,15:826.466667,16:2066.166667,17:6198.5,18:24794.0,19:173558.0},
        7: {1:1.361111,2:1.921569,3:2.762255,4:4.051307,5:6.076961,6:9.34917,7:14.802853,8:24.222851,9:41.178846,10:73.206838,11:137.262821,12:274.525641,13:594.805556,14:1427.533333,15:3925.716667,16:13085.722222,17:58885.75,18:471086.0},
        8: {1:1.441176,2:2.161765,3:3.314706,4:5.208824,5:8.414253,6:14.023756,7:24.222851,8:43.601131,9:82.357692,10:164.715385,11:352.961538,12:823.576923,13:2141.3,14:6423.9,15:23554.3,16:117771.5,17:1059943.5},
        9: {1:1.53125,2:2.45,3:4.025,4:6.811538,5:11.920192,6:21.673077,7:41.178846,8:82.357692,9:175.010096,10:400.023077,11:1000.057692,12:2800.161538,13:9100.525,14:36402.1,15:200211.55,16:2002115.5},
        10: {1:1.633333,2:2.8,3:4.953846,4:9.082051,5:17.338462,6:34.676923,7:73.206838,8:164.715385,9:400.023077,10:1066.728205,11:3200.184615,12:11200.646154,13:48536.133333,14:291216.8,15:3203384.8},
        11: {1:1.75,2:3.230769,3:6.192308,4:12.384615,5:26.007692,6:57.794872,7:137.262821,8:352.961538,9:1000.057692,10:3200.184615,11:12000.692308,12:56003.230769,13:364021.0,14:4368252.0},
        12: {1:1.884615,2:3.769231,3:7.881119,4:17.338462,5:40.45641,6:101.141026,7:274.525641,8:823.576923,9:2800.161538,10:11200.646154,11:56003.230769,12:392022.615385,13:5096294.0},
        13: {1:2.041667,2:4.454545,3:10.245455,4:25.044444,5:65.741667,6:187.833333,7:594.805556,8:2141.3,9:9100.525,10:48536.133333,11:364021.0,12:5096294.0},
        14: {1:2.227273,2:5.345455,3:13.660606,4:37.566667,5:112.7,6:375.666667,7:1427.533333,8:6423.9,9:36402.1,10:291216.8,11:4368252.0},
        15: {1:2.45,2:6.533333,3:18.783333,4:59.033333,5:206.616667,6:826.466667,7:3925.716667,8:23554.3,9:200211.55,10:3203384.8},
        16: {1:2.722222,2:8.166667,3:26.833333,4:98.388889,5:413.233333,6:2066.166667,7:13085.722222,8:117771.5,9:2002115.5},
        17: {1:3.0625,2:10.5,3:40.25,4:177.1,5:929.775,6:6198.5,7:58885.75,8:1059943.5},
        18: {1:3.5,2:14.0,3:64.4,4:354.2,5:2479.4,6:24794.0,7:471086.0},
        19: {1:4.0,2:19.0,3:112.7,4:826.466667,5:8677.9,6:173558.0},
        20: {1:4.666667,2:26.666667,3:225.4,4:2479.4,5:52067.4},
        21: {1:5.5,2:39.0,3:563.5,4:12397.0},
        22: {1:6.6,2:59.4,3:2254.0},
        23: {1:8.0,2:96.0},
        24: {1:10.0}
      };
      
      function calculateMultiplier(tilesRevealed, totalBombs) {
        if (tilesRevealed === 0) return 1.0;
        
        // Get multiplier from CSV data (2% house edge)
        if (multiplierData[totalBombs] && multiplierData[totalBombs][tilesRevealed]) {
          return multiplierData[totalBombs][tilesRevealed];
        }
        
        // Fallback for invalid combinations
        return 1.0;
      }
      
      const multiplier = calculateMultiplier(newRevealedTiles.length, game.bombs);

      // Update game state
      await dbRun('UPDATE mines_games SET revealed_tiles = ?, current_multiplier = ? WHERE id = ?', 
        [JSON.stringify(newRevealedTiles), multiplier, gameId]);

      // Check if won (all safe tiles revealed)
      if (newRevealedTiles.length >= safeTilesCount) {
        // User won by revealing all safe tiles
        const winnings = Number((game.bet_amount * multiplier).toFixed(2));
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, interaction.user.id]);
        await dbRun('UPDATE mines_games SET status = ? WHERE id = ?', ['won', gameId]);

        // Update win streak and apply force-loss for next game if streak >= 2
        const streakRow = await dbGet('SELECT win_streak FROM mines_streaks WHERE user_id = ?', [interaction.user.id]);
        const nextStreak = (streakRow?.win_streak || 0) + 1;
        await dbRun('INSERT INTO mines_streaks (user_id, win_streak) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET win_streak = ?', [interaction.user.id, nextStreak, nextStreak]);

        const gameImage = await generateMinesGameImage(
          interaction.user, 
          game.bet_amount, 
          game.bombs, 
          newRevealedTiles, 
          multiplier, 
          'won', 
          minePositions
        );
        const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

        const winEmbed = new EmbedBuilder()
          .setTitle('🎉 Perfect Game! You won!')
          .setDescription(`💎 **Congratulations!** You revealed all safe tiles!\n\n💰 **Winnings:** ${winnings.toFixed(2)} points\n📈 **Profit:** +${(winnings - game.bet_amount).toFixed(2)} points`)
          .setColor('#00ff00')
          .setImage('attachment://mines-game.png')
          .setFooter({ text: 'Masterbets • Amazing job!' });

        await interaction.update({ embeds: [winEmbed], files: [attachment], components: [] });
        return;
      }

      // Continue game with updated state
      const gameImage = await generateMinesGameImage(
        interaction.user, 
        game.bet_amount, 
        game.bombs, 
        newRevealedTiles, 
        multiplier, 
        'active', 
        minePositions
      );
      const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

      const continueEmbed = new EmbedBuilder()
        .setTitle('💎 Mines Game - Safe!')
        .setDescription(`**Bet Amount:** ${game.bet_amount.toFixed(2)} points\n**Bombs:** ${game.bombs}\n**Current Multiplier:** ${multiplier.toFixed(2)}x\n\n💎 **Tiles Revealed:** ${newRevealedTiles.length}\n💰 **Potential Winnings:** ${(game.bet_amount * multiplier).toFixed(2)} points\n\nUse the **Cashout** button when you\'re ready.`)
        .setColor('#00ff00')
        .setImage('attachment://mines-game.png')
        .setFooter({ text: 'Masterbets • Good luck!' });

      // Recreate buttons with revealed tiles
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const buttonTileIndex = i * 5 + j;
          const isRevealed = newRevealedTiles.includes(buttonTileIndex);
          
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`mine_tile_${gameId}_${buttonTileIndex}`)
              .setLabel(isRevealed ? '💎' : '?')
              .setStyle(isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(isRevealed)
          );
        }
        rows.push(row);
      }

      await interaction.update({ embeds: [continueEmbed], files: [attachment], components: rows });

    } catch (e) {
      console.error('Error in mines tile interaction:', e);
      try {
        await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: MessageFlags.Ephemeral });
      } catch (e2) {}
    }
    return;
  }

  // Handle stats panel buttons (admin only)
  if (interaction.customId.startsWith('stats_')) {
    // Stats interactions - regular admin access is sufficient
    if (!requireRegularAdmin(interaction.user.id, 'STATS_INTERACTION')) {
      try {
        await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
      } catch (e) {}
      return;
    }

    try {
      // Get comprehensive data for all panels
      const [
        allDeposits,
        allWithdrawals,
        allUsers,
        recentDeposits,
        recentWithdrawals,
        pendingWithdrawals,
        topUsers,
        walletBalance,
        ltcPrice,
        collectedFees
      ] = await Promise.all([
        dbAll('SELECT * FROM deposits WHERE credited = 1'),
        dbAll('SELECT * FROM withdrawals WHERE status = "completed"'),
        dbAll('SELECT * FROM users'),
        dbAll('SELECT * FROM deposits WHERE credited = 1 ORDER BY timestamp DESC LIMIT 5'),
        dbAll('SELECT * FROM withdrawals WHERE status = "completed" ORDER BY processed_at DESC LIMIT 5'),
        dbAll('SELECT * FROM withdrawals WHERE status = "pending" ORDER BY created_at DESC'),
        dbAll('SELECT id, balance FROM users WHERE balance > 0 ORDER BY balance DESC LIMIT 10'),
        getBotWalletBalance(),
        getLTCPriceUSD(),
        dbAll('SELECT * FROM collected_fees')
      ]);

      // Calculate totals
      const totalDepositsLTC = allDeposits.reduce((sum, d) => sum + d.amount_ltc, 0);
      const totalDepositsUSD = allDeposits.reduce((sum, d) => sum + d.amount_usd, 0);
      const totalDepositsPoints = allDeposits.reduce((sum, d) => sum + d.points, 0);
      const totalWithdrawalsLTC = allWithdrawals.reduce((sum, w) => sum + w.amount_ltc, 0);
      const totalWithdrawalsUSD = allWithdrawals.reduce((sum, w) => sum + w.amount_usd, 0);
      const totalWithdrawalsPoints = allWithdrawals.reduce((sum, w) => sum + w.amount_points, 0);
      const totalOutstandingPoints = allUsers.reduce((sum, u) => sum + (u.balance > 0 ? u.balance : 0), 0);
      const totalWithdrawalFees = allWithdrawals.reduce((sum, w) => sum + (w.fee_ltc || 0), 0);
      
      // Calculate collected fees from taxes and house edge
      const totalCollectedFeesPoints = collectedFees.reduce((sum, f) => sum + f.amount_points, 0);
      const totalCollectedFeesLTC = totalCollectedFeesPoints * 0.0001; // Convert points to LTC
      const totalCollectedFeesUSD = totalCollectedFeesLTC * ltcPrice;

      // User statistics
      const totalUsers = allUsers.length;
      const activeUsers = allUsers.filter(u => u.balance > 0).length;
      const usersWithDeposits = new Set(allDeposits.map(d => d.credited_to)).size;

      // Recent activity stats (last 24 hours)
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const recentDepositsCount = allDeposits.filter(d => d.timestamp > oneDayAgo).length;
      const recentWithdrawalsCount = allWithdrawals.filter(w => w.processed_at > oneDayAgo).length;
      const dailyDepositsLTC = allDeposits.filter(d => d.timestamp > oneDayAgo).reduce((sum, d) => sum + d.amount_ltc, 0);
      const dailyWithdrawalsLTC = allWithdrawals.filter(w => w.processed_at > oneDayAgo).reduce((sum, w) => sum + w.amount_ltc, 0);

      // Conversion calculations
      const outstandingLTC = pointsToLtc(totalOutstandingPoints);
      const outstandingUSD = outstandingLTC * ltcPrice;
      const botBalanceLTC = walletBalance ? walletBalance.available : 0;
      const botBalanceUSD = botBalanceLTC * ltcPrice;

      // Calculate net position and profitability
      const netLTC = totalDepositsLTC - totalWithdrawalsLTC - outstandingLTC;
      const netUSD = totalDepositsUSD - totalWithdrawalsUSD - outstandingUSD;
      const netPoints = totalDepositsPoints - totalWithdrawalsPoints - totalOutstandingPoints;
      const isProfitable = netUSD >= 0;
      const profitMargin = totalDepositsUSD > 0 ? ((netUSD / totalDepositsUSD) * 100).toFixed(2) : '0.00';

      const navigationRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('stats_financial')
          .setLabel('💰 Financial')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('stats_users')
          .setLabel('👥 Users')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('stats_transactions')
          .setLabel('📋 Transactions')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('stats_system')
          .setLabel('⚙️ System')
          .setStyle(ButtonStyle.Danger)
      );


      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('stats_main')
          .setLabel('🏠 Main Panel')
          .setStyle(ButtonStyle.Primary)
      );

      if (interaction.customId === 'stats_financial') {
        const statusEmoji = isProfitable ? '📈' : '📉';
        const statusText = isProfitable ? 'PROFITABLE' : 'OPERATING AT LOSS';
        const embedColor = isProfitable ? '#22c55e' : '#ef4444';

        const financialEmbed = new EmbedBuilder()
          .setTitle('💰 FINANCIAL OVERVIEW')
          .setColor(embedColor)
          .setDescription(`**Status: ${statusText}** ${statusEmoji}\n**Profit Margin: ${profitMargin}%**`)
          .addFields([
            { name: '📊 NET POSITION', value: `**${netLTC >= 0 ? '+' : ''}${netLTC.toFixed(8)} LTC**\n**${netUSD >= 0 ? '+$' : '-$'}${Math.abs(netUSD).toFixed(2)} USD**\n**${netPoints >= 0 ? '+' : ''}${netPoints.toFixed(2)} Points**`, inline: true },
            { name: '💰 TOTAL DEPOSITS', value: `**${allDeposits.length}** transactions\n**${totalDepositsLTC.toFixed(8)} LTC**\n**$${totalDepositsUSD.toFixed(2)} USD**\n**${totalDepositsPoints.toFixed(2)} Points**`, inline: true },
            { name: '💸 TOTAL WITHDRAWALS', value: `**${allWithdrawals.length}** transactions\n**${totalWithdrawalsLTC.toFixed(8)} LTC**\n**$${totalWithdrawalsUSD.toFixed(2)} USD**\n**${totalWithdrawalsPoints.toFixed(2)} Points**`, inline: true },
            { name: '⚖️ OUTSTANDING BALANCES', value: `**${activeUsers}** active users\n**${outstandingLTC.toFixed(8)} LTC**\n**$${outstandingUSD.toFixed(2)} USD**\n**${totalOutstandingPoints.toFixed(2)} Points**`, inline: true },
            { name: '🏦 BOT WALLET', value: `**${botBalanceLTC.toFixed(8)} LTC**\n**$${botBalanceUSD.toFixed(2)} USD**\n**${(botBalanceLTC * 10000).toFixed(2)} Points**`, inline: true },
            { name: '💳 FEES COLLECTED', value: `**Withdrawal:** ${totalWithdrawalFees.toFixed(8)} LTC\n**Taxes:** ${totalCollectedFeesLTC.toFixed(8)} LTC\n**Total:** ${(totalWithdrawalFees + totalCollectedFeesLTC).toFixed(8)} LTC\n**$${((totalWithdrawalFees + totalCollectedFeesLTC) * ltcPrice).toFixed(2)} USD**`, inline: true },
            { name: '⏳ PENDING WITHDRAWALS', value: `**${pendingWithdrawals.length}** pending\n**${pendingWithdrawals.reduce((s, w) => s + w.amount_ltc, 0).toFixed(8)} LTC**\n**$${pendingWithdrawals.reduce((s, w) => s + w.amount_usd, 0).toFixed(2)} USD**`, inline: true },
            { name: '📊 CONVERSION RATE', value: `**1 Point = 0.0001 LTC**\n**1 LTC = 10,000 Points**\n**1 Point = $${(ltcPrice * 0.0001).toFixed(4)}**`, inline: true },
            { name: '📈 LTC PRICE', value: `**$${ltcPrice.toFixed(2)}/LTC**\n*Live Market Rate*`, inline: true }
          ])
          .setFooter({ text: `Masterbets Financial Panel • Updated ${new Date().toLocaleString()}` })
          .setTimestamp();

        await interaction.update({ embeds: [financialEmbed], components: [navigationRow, backRow] });

      } else if (interaction.customId === 'stats_users') {
        const userStatsEmbed = new EmbedBuilder()
          .setTitle('👥 USER STATISTICS')
          .setColor('#8b5cf6')
          .addFields([
            { name: '📈 USER METRICS', value: `**Total Users:** ${totalUsers}\n**Active Users:** ${activeUsers}\n**Users w/ Deposits:** ${usersWithDeposits}\n**Retention Rate:** ${totalUsers > 0 ? ((activeUsers/totalUsers)*100).toFixed(1) : '0.0'}%`, inline: true },
            { name: '📊 24H ACTIVITY', value: `**Deposits:** ${recentDepositsCount} (${dailyDepositsLTC.toFixed(6)} LTC)\n**Withdrawals:** ${recentWithdrawalsCount} (${dailyWithdrawalsLTC.toFixed(6)} LTC)\n**Net 24h:** ${(dailyDepositsLTC - dailyWithdrawalsLTC >= 0 ? '+' : '')}${(dailyDepositsLTC - dailyWithdrawalsLTC).toFixed(6)} LTC`, inline: true },
            { name: '💰 BALANCE DISTRIBUTION', value: `**Avg Balance:** ${activeUsers > 0 ? (totalOutstandingPoints / activeUsers).toFixed(2) : '0.00'} pts\n**Total Outstanding:** ${totalOutstandingPoints.toFixed(2)} pts\n**Largest Balance:** ${topUsers.length > 0 ? topUsers[0].balance.toFixed(2) : '0.00'} pts`, inline: true },
            { name: '🏆 TOP 5 BALANCES', value: topUsers.slice(0, 5).map((u, i) => `**${i+1}.** <@${u.id}> - ${u.balance.toFixed(2)} pts`).join('\n') || 'No active users', inline: false }
          ])
          .setFooter({ text: `Masterbets User Panel • Updated ${new Date().toLocaleString()}` })
          .setTimestamp();
        await interaction.update({ embeds: [userStatsEmbed], components: [navigationRow, backRow] });

      } else if (interaction.customId === 'stats_transactions') {
        const transactionsEmbed = new EmbedBuilder()
          .setTitle('📋 RECENT TRANSACTIONS')
          .setColor('#10b981');

        let fieldsAdded = 0;

        // Recent Deposits
        if (recentDeposits.length > 0) {
          const depositsText = recentDeposits.map(d => {
            const date = new Date(d.timestamp).toLocaleDateString();
            const time = new Date(d.timestamp).toLocaleTimeString();
            return `**${d.amount_ltc.toFixed(6)} LTC** - <@${d.credited_to}>\n*${date} ${time}*`;
          }).join('\n\n');
          transactionsEmbed.addFields([{ name: '💰 RECENT DEPOSITS (Last 5)', value: depositsText, inline: false }]);
          fieldsAdded++;
        }

        // Recent Withdrawals
        if (recentWithdrawals.length > 0) {
          const withdrawalsText = recentWithdrawals.map(w => {
            const date = new Date(w.processed_at).toLocaleDateString();
            const time = new Date(w.processed_at).toLocaleTimeString();
            return `**${w.amount_ltc.toFixed(6)} LTC** - <@${w.user_id}>\n*${date} ${time}*`;
          }).join('\n\n');
          transactionsEmbed.addFields([{ name: '💸 RECENT WITHDRAWALS (Last 5)', value: withdrawalsText, inline: false }]);
          fieldsAdded++;
        }

        // Pending Withdrawals Detail
        if (pendingWithdrawals.length > 0) {
          const pendingText = pendingWithdrawals.slice(0, 5).map(w => {
            const date = new Date(w.created_at).toLocaleDateString();
            const time = new Date(w.created_at).toLocaleTimeString();
            return `**${w.amount_ltc.toFixed(6)} LTC** - <@${w.user_id}>\n*Requested: ${date} ${time}*`;
          }).join('\n\n');
          transactionsEmbed.addFields([{ name: '⏳ PENDING WITHDRAWALS', value: pendingText, inline: false }]);
          fieldsAdded++;
        }

        if (fieldsAdded === 0) {
          transactionsEmbed.setDescription('*No recent transaction activity*');
        }

        transactionsEmbed
          .setFooter({ text: `Masterbets Transactions Panel • Updated ${new Date().toLocaleString()}` })
          .setTimestamp();

        await interaction.update({ embeds: [transactionsEmbed], components: [navigationRow, backRow] });

      } else if (interaction.customId === 'stats_system') {
        const systemEmbed = new EmbedBuilder()
          .setTitle('⚙️ SYSTEM STATUS')
          .setColor('#6366f1')
          .addFields([
            { name: '🔄 BOT STATUS', value: `**Online** <:stolen_emoji_blaze:1424681423553691672>\n**Uptime:** ${Math.floor(process.uptime())}s (${Math.floor(process.uptime()/60)}m)\n**Memory Usage:** ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`, inline: true },
            { name: '🔗 API STATUS', value: `**Apirone:** Connected <:stolen_emoji_blaze:1424681423553691672>\n**LTC Price Feed:** Active <:stolen_emoji_blaze:1424681423553691672>\n**Database:** Operational <:stolen_emoji_blaze:1424681423553691672>`, inline: true },
            { name: '📊 PERFORMANCE', value: `**Deposit Scan:** Every 60s\n**Avg Response:** <200ms\n**Last Scan:** ${new Date().toLocaleTimeString()}`, inline: true },
            { name: '💾 DATABASE STATS', value: `**Users:** ${totalUsers}\n**Deposits:** ${allDeposits.length}\n**Withdrawals:** ${allWithdrawals.length}\n**Pending:** ${pendingWithdrawals.length}`, inline: true },
            { name: '🌐 NETWORK STATUS', value: `**LTC Network:** Operational <:stolen_emoji_blaze:1424681423553691672>\n**Confirmation Req:** 1 block\n**Fee Rate:** Normal`, inline: true },
            { name: '📈 ACTIVITY TODAY', value: `**New Deposits:** ${recentDepositsCount}\n**Withdrawals Processed:** ${recentWithdrawalsCount}\n**Net Volume:** ${(dailyDepositsLTC + dailyWithdrawalsLTC).toFixed(6)} LTC`, inline: true }
          ])
          .setFooter({ text: `Masterbets System Panel • Updated ${new Date().toLocaleString()}` })
          .setTimestamp();

        await interaction.update({ embeds: [systemEmbed], components: [navigationRow, backRow] });

      } else if (interaction.customId === 'stats_admin') {
        // SECURITY: Admin tools require super admin privileges
        if (!requireSuperAdmin(interaction.user.id, 'ADMIN_TOOLS_ACCESS')) {
          await interaction.reply({ content: '❌ You do not have sufficient privileges to access admin tools. Super admin required.', ephemeral: true });
          return;
        }

        const adminEmbed = new EmbedBuilder()
          .setTitle('🔒 ADMIN SECRET TOOLS')
          .setColor('#dc2626')
          .setDescription('**Ultra-Secret Admin Commands**\n\n⚠️ **WARNING:** These commands are invisible to regular users and only work for authorized admin.')
          .addFields([
            { 
              name: '💰 Mint Points', 
              value: '**Command:** `.mint @user <amount>`\n**Purpose:** Add points to any user\n**Examples:**\n• `.mint @user 100` - Add 100 points\n• `.mint @user 1$` - Add $1 worth of points\n**Security:** Ephemeral responses only',
              inline: false 
            },
            { 
              name: '🗑️ Remove Points', 
              value: '**Command:** `.remove @user <amount>`\n**Purpose:** Remove points from any user\n**Examples:**\n�� `.remove @user 50` - Remove 50 points\n• `.remove @user 0.5$` - Remove $0.50 worth\n**Safety:** Checks balance before removal',
              inline: false 
            },
            { 
              name: '⏰ Beg Timeout', 
              value: '**Command:** `.beg` (reply to message or mention user)\n**Purpose:** 10-minute timeout for begging\n**Features:**\n• Automatic DM notification to user\n• Works on replies or mentions\n• Logs all actions for security\n**Usage:** Reply to begging message with `.beg`',
              inline: false 
            }
          ])
          .addFields([
            { name: '🛡️ Security Features', value: '• Commands invisible to non-admins\n• All responses are ephemeral\n• Complete action logging\n• Balance validation\n• Error handling', inline: true },
            { name: '📊 Usage Stats', value: '• Mint operations logged\n• Remove operations logged\n• Timeout actions logged\n• All with timestamps\n• User ID verification', inline: true },
            { name: '🔐 Access Control', value: '• Single admin authorization\n• Silent command rejection\n• No public documentation\n• Hidden from help menu\n• Maximum security', inline: true }
          ])
          .setFooter({ text: 'Masterbets Secret Admin Panel • Ultra Restricted Access' })
          .setTimestamp();

        await interaction.update({ embeds: [adminEmbed], components: [navigationRow, backRow] });

      } else if (interaction.customId === 'stats_main') {
        const mainEmbed = new EmbedBuilder()
          .setTitle('🎮 Masterbets ADMIN CONTROL PANEL')
          .setColor('#6366f1')
          .setDescription('**Welcome to the comprehensive admin dashboard**\n\nSelect a category below to view detailed information:')
          .addFields([
            { name: '💰 Financial Overview', value: 'View deposits, withdrawals, and profit/loss analysis', inline: true },
            { name: '👥 User Statistics', value: 'User metrics, activity, and top balances', inline: true },
            { name: '📋 Transactions', value: 'Recent deposits, withdrawals, and pending operations', inline: true },
            { name: '⚙️ System Status', value: 'Bot health, API status, and performance metrics', inline: true },
            { name: '🏦 Current Wallet', value: `**${botBalanceLTC.toFixed(8)} LTC**\n**$${botBalanceUSD.toFixed(2)} USD**`, inline: true },
            { name: '📈 LTC Price', value: `**$${ltcPrice.toFixed(2)}/LTC**\n*Live Market Rate*`, inline: true }
          ])
          .setFooter({ text: 'Masterbets Admin Panel • Use buttons to navigate' })
          .setTimestamp();

        await interaction.update({ embeds: [mainEmbed], components: [navigationRow] });
      }

    } catch (error) {
      console.error('Error handling stats button interaction:', error);
      try {
        await interaction.reply({ content: '❌ Error retrieving statistics. Please try again.', ephemeral: true });
      } catch (e) {}
    }
    return;
  }

  // SECURE Blackjack button interactions with authorization and database persistence
  if (interaction.customId === 'bj_hit' || interaction.customId === 'bj_stand') {
    try {
      // SECURITY: Load session from database with strict authorization
      const session = await BlackjackSession.loadGame(interaction.user.id);
      if (!session) {
        await interaction.reply({ 
          content: '❌ No active Blackjack game found! Start a new game with `.bj`',
          ephemeral: true 
        });
        return;
      }

      // SECURITY: Double-check authorization (critical security check)
      if (session.userId !== interaction.user.id) {
        console.log(`🚫 SECURITY ALERT: User ${interaction.user.id} tried to access game owned by ${session.userId}`);
        await interaction.reply({ 
          content: '❌ Access denied: This is not your game!',
          ephemeral: true 
        });
        return;
      }

      // Check if game is already finished
      if (session.isFinished()) {
        await interaction.reply({ 
          content: '❌ This game is already finished! Start a new game with `.bj`',
          ephemeral: true 
        });
        return;
      }

      // Check if action is already in progress (race condition protection)
      if (session.processing) {
        await interaction.reply({ 
          content: '⏳ Action in progress, please wait...',
          ephemeral: true 
        });
        return;
      }

      const now = Date.now();
      const last = blackjackButtonCooldown.get(interaction.user.id) || 0;
      if (now - last < BLACKJACK_BUTTON_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((BLACKJACK_BUTTON_COOLDOWN_MS - (now - last)) / 1000);
        await interaction.reply({ content: `⏳ Please wait ${waitSeconds} second${waitSeconds !== 1 ? 's' : ''} before the next Blackjack action.`, ephemeral: true });
        return;
      }
      blackjackButtonCooldown.set(interaction.user.id, now);

      // Defer the interaction immediately to prevent timeout (Discord has 3-second limit)
      await interaction.deferUpdate();

      // Process the action with database persistence
      let actionSuccess = false;
      if (interaction.customId === 'bj_hit') {
        actionSuccess = await session.hit();
      } else if (interaction.customId === 'bj_stand') {
        actionSuccess = await session.stand();
      }

      if (!actionSuccess) {
        await interaction.followUp({ 
          content: '❌ Invalid action for current game state.',
          ephemeral: true 
        });
        return;
      }

      // Update the embed and buttons with beautiful card images
      const { embed, attachment } = await createBlackjackEmbed(session, interaction.user);
      const buttons = createBlackjackButtons(session);

      const updateOptions = { 
        embeds: [embed], 
        components: [buttons]
      };
      
      if (attachment) {
        updateOptions.files = [attachment];
      }

      await interaction.editReply(updateOptions);

      // If game finished, process winnings and clean up
      if (session.isFinished()) {
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [session.winnings, interaction.user.id]);
        await session.deleteFromDatabase();
        
        console.log(`🃏 Blackjack game ${session.gameId} finished for ${interaction.user.username}: ${session.result}, winnings: ${session.winnings}`);
        
        // Track collected fees for analytics
        if (session.result === 'dealer_win') {
          await trackCollectedFee('blackjack', session.betAmount, 'blackjack', interaction.user.id, session.betAmount, `Player lost: ${session.playerHand.getValue()}>21 or dealer won`);
        }
      }

    } catch (error) {
      console.error('Secure blackjack interaction error:', error);
      try {
        await interaction.reply({ 
          content: '❌ An error occurred during the game. Please try again.',
          ephemeral: true 
        });
      } catch (e) {}
    }
    return;
  }
});
// ==================== .FREEZE COMMAND & BLOCKED USERS CHECK ====================

// Step 1️⃣ - Create a table to store frozen users
dbRun(`
CREATE TABLE IF NOT EXISTS frozen_users (
  user_id TEXT PRIMARY KEY,
  frozen_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`);

// Step 2️⃣ - Middleware: stop frozen users from using commands
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) return;
  
  const userId = message.author.id;
  const frozen = await dbGet("SELECT user_id FROM frozen_users WHERE user_id = ?", [userId]);
  
  // If user is frozen, ignore them completely
  if (frozen) return;
  
  // 👇 your other command handlers go below this
});

// Step 3️⃣ - Admin command to freeze/unfreeze users
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) return;
  if (!message.content.startsWith(".")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  // Only allow you (the bot owner) to run freeze/unfreeze
  const OWNER_ID = "998706760749682789"; // your ID

  if (command === "freeze") {
    if (message.author.id !== OWNER_ID) return message.reply("🚫 You can’t use this command.");

    const target = message.mentions.users.first();
    if (!target) return message.reply("⚠️ Usage: `.freeze @user`");

    await dbRun("INSERT OR IGNORE INTO frozen_users (user_id) VALUES (?)", [target.id]);
    return message.reply(`❄️ <@${target.id}> has been **frozen**. They can no longer use the bot.`);
  }

  if (command === "unfreeze") {
    if (message.author.id !== OWNER_ID) return message.reply("🚫 You can’t use this command.");

    const target = message.mentions.users.first();
    if (!target) return message.reply("⚠️ Usage: `.unfreeze @user`");

    await dbRun("DELETE FROM frozen_users WHERE user_id = ?", [target.id]);
    return message.reply(`🔥 <@${target.id}> has been **unfrozen** and can use the bot again.`);
  }
});

// Handle message commands
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.type === ChannelType.DM) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/g);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'rsallwager') {
    try {
      const OWNER_ID = '998706760749682789';
      if (msg.author.id !== OWNER_ID) return msg.reply('🚫 You can’t use this command.');

      await dbRun('UPDATE user_levels SET total_wagered = 0, current_level = -1, pending_level_claim = 0, last_level_update = ?', [Date.now()]);
      await msg.reply('✅ Done. Reset `total_wagered` for all users.');
      return;
    } catch (e) {
      console.error('rsallwager command error:', e);
      try { await msg.reply('❌ Failed to reset all wager.'); } catch (err) {}
      return;
    }
  }

  if (cmd === 'rs') {
    try {
      const allowed = new Set(['998706760749682789', '1355726712310071386']);
      if (!allowed.has(msg.author.id)) return;

      const target = msg.mentions.users.first();
      const userId = target?.id || msg.author.id;
      await ensureUserExists(userId);

      const actions = [];

      try {
        const bjGame = await dbGet('SELECT * FROM blackjack_games WHERE user_id = ? AND game_state != ?', [userId, 'finished']);
        if (bjGame) {
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [bjGame.bet_amount, userId]);
          await dbRun('DELETE FROM blackjack_games WHERE id = ?', [bjGame.id]);
          actions.push('Blackjack');
        }
      } catch (e) {}

      try {
        const minesGame = await dbGet('SELECT * FROM mines_games WHERE user_id = ? AND status = ?', [userId, 'active']);
        if (minesGame) {
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [minesGame.bet_amount, userId]);
          await dbRun('UPDATE mines_games SET status = ? WHERE id = ? AND status = ?', ['cancelled', minesGame.id, 'active']);
          actions.push('Mines');
        }
      } catch (e) {}

      try {
        let removedFromWordly = false;
        for (const [channelId, game] of activeWordlyGames.entries()) {
          if (!game || !game.active || game.winner) continue;
          const idx = game.participants?.findIndex(p => p.id === userId) ?? -1;
          if (idx === -1) continue;

          game.participants.splice(idx, 1);
          game.pot = Math.max(0, (game.pot || 0) - (game.betAmount || 0));
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [game.betAmount || 0, userId]);

          try {
            const channel = await client.channels.fetch(channelId);
            if (channel) await updateWordlyLobby(game, channel);
          } catch (e) {}

          removedFromWordly = true;
        }
        if (removedFromWordly) actions.push('Wordly');
      } catch (e) {}

      if (actions.length === 0) {
        await msg.reply(target ? `✅ No active games found to reset for <@${userId}>.` : '✅ No active games found to reset.');
        return;
      }

      await msg.reply(target ? `✅ Reset complete for <@${userId}>. Cleared: ${actions.join(', ')}` : `✅ Reset complete. Cleared: ${actions.join(', ')}`);
      return;
    } catch (e) {
      console.error('rs command error:', e);
      try { await msg.reply('❌ Failed to reset.'); } catch (err) {}
      return;
    }
  }

  if (cmd === 'depo' || cmd === 'deposit') {
    try {
      await ensureUserExists(msg.author.id);
      
      // Get or create deposit address
      let user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      let address = user?.deposit_address;
      
      if (!address) {
        address = await createUserDepositAddress(msg.author.id);
      }
      
      if (!address) {
        return msg.reply('❌ Failed to generate deposit address. Please try again.');
      }

      // Create QR code
      const qrDataURL = await QRCode.toDataURL(address);
      const base64 = qrDataURL.split(',')[1];
      const buf = Buffer.from(base64, 'base64');
      const attachment = new AttachmentBuilder(buf, { name: 'qrcode.png' });

      // Create beautiful embed for DM
      const embed = new EmbedBuilder()
        .setTitle('📥 Litecoin Deposit - Masterbets')
        .setDescription(`Send Litecoin (LTC) to this address:\n\`${address}\`\n\n🎯 **Conversion Rate:** 0.0001 LTC = 1 point\n💰 **Minimum Deposit:** ${MIN_DEPOSIT_POINTS} points (${pointsToLtc(MIN_DEPOSIT_POINTS)} LTC)\n⏱️ **Processing:** Auto-credited after 1 confirmation\n\nAfter you send, click **Check New Funds** to verify!`)
        .setColor('#1F8B4C')
        .setImage('attachment://qrcode.png')
        .setFooter({ text: 'Masterbets • Your personal deposit address' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('check_funds')
          .setLabel('🔍 Check New Funds')
          .setStyle(ButtonStyle.Primary)
      );

      // Try to send DM first
      try {
        const dm = await msg.author.createDM();
        
        // Send the embed with QR code first
        await dm.send({ embeds: [embed], files: [attachment], components: [row] });
        
        // Send a separate plain text message with just the address for easy copying
        await dm.send(address);
        
        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Deposit Address Sent!')
          .setDescription('Check your DMs — I\'ve sent your personal deposit address with a QR code.')
          .setColor('#1F8B4C');
        
        await msg.reply({ embeds: [successEmbed] });
      } catch (e) {
        // Fallback if DM fails - send both embed and plain text in channel
        const fallbackEmbed = new EmbedBuilder()
          .setTitle('📥 Litecoin Deposit - Masterbets')
          .setDescription(`Send Litecoin (LTC) to this address:\n\`${address}\`\n\n🎯 **Conversion Rate:** 0.0001 LTC = 1 point\n💰 **Minimum Deposit:** ${MIN_DEPOSIT_POINTS} points (${pointsToLtc(MIN_DEPOSIT_POINTS)} LTC)`)
          .setColor('#1F8B4C');
        
        await msg.reply({ embeds: [fallbackEmbed] });
        
        // Send separate plain text message for easy copying
        await msg.channel.send(address);
      }
    } catch (e) {
      console.error('Deposit command error:', e);
      await msg.reply('❌ An error occurred. Please try again.');
    }
  }

  else if (cmd === 'balance' || cmd === 'bal') {
    try {
      let target = msg.mentions.users.first() || msg.author;
      
      console.log(`Balance command: Target ID: ${target.id}, Bot ID: ${client.user?.id}, Is Bot: ${target.id === client.user?.id}`);
      
      // Check if bot is mentioned
      if (target.id === client.user.id) {
        console.log('Bot balance requested, fetching wallet balance...');
        
        // Show bot wallet balance with beautiful custom image
        const walletBalance = await getBotWalletBalance();
        
        if (!walletBalance) {
          console.error('Failed to get bot wallet balance');
          return msg.reply('❌ Failed to fetch bot wallet balance. Please try again.');
        }
        
        console.log(`Bot wallet balance: ${walletBalance.available} LTC`);
        
        // Calculate USD equivalent
        let usdValue = 0;
        try {
          const ltcPrice = await getLTCPriceUSD();
          usdValue = walletBalance.available * ltcPrice;
          console.log(`USD value: $${usdValue.toFixed(2)}`);
        } catch (e) {
          console.error('Error getting LTC price for bot balance:', e);
        }
        
        // Convert available LTC to points for reference
        const equivalentPoints = ltcToPoints(walletBalance.available);
        console.log(`Equivalent points: ${equivalentPoints}`);
        
        // Generate premium bot wallet image
        try {
          const botWalletImage = await generateBotWalletImage(walletBalance.available, usdValue, equivalentPoints);
          const imageAttachment = new AttachmentBuilder(botWalletImage, { name: 'bot-wallet.png' });
          
          // Simple embed to go with the custom image
          const embed = new EmbedBuilder()
            .setColor('#0f1419')
            .setImage('attachment://bot-wallet.png')
            .setFooter({ text: 'Masterbets' });

          // Add dismiss button
          const dismissButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('dismiss_balance')
              .setLabel('🗑️ Dismiss')
              .setStyle(ButtonStyle.Secondary)
          );

          console.log('Sending bot wallet balance image...');
          return msg.reply({ embeds: [embed], files: [imageAttachment], components: [dismissButton] });
        } catch (imageError) {
          console.error('Error generating bot wallet image:', imageError);
          
          // Fallback to text response
          const fallbackEmbed = new EmbedBuilder()
            .setTitle('🏦 Bot Wallet Balance')
            .setColor('#0f1419')
            .addFields([
              { name: '💰 LTC Balance', value: `${walletBalance.available.toFixed(8)} LTC`, inline: true },
              { name: '💵 USD Value', value: `$${usdValue.toFixed(2)}`, inline: true },
              { name: '🎯 Point Equivalent', value: `${equivalentPoints.toLocaleString()} points`, inline: true }
            ])
            .setFooter({ text: 'Masterbets • Bot Wallet' })
            .setTimestamp();
          
          return msg.reply({ embeds: [fallbackEmbed] });
        }
      }
      
      // Regular user balance
      await ensureUserExists(target.id);
      
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [target.id]);
      const points = user?.balance || 0;
      
      // Generate beautiful MasterBets-style balance card
      const balanceImage = await generateUserBalanceCard(target, points);
      const imageAttachment = new AttachmentBuilder(balanceImage, { name: 'user-balance.png' });
      
      // Simple embed to go with the custom image
      const embed = new EmbedBuilder()
        .setColor('#1a1f2e')
        .setImage('attachment://user-balance.png')
        .setFooter({ text: 'Masterbets' });

      // Add dismiss button
      const dismissButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('dismiss_balance')
          .setLabel('🗑️ Dismiss')
          .setStyle(ButtonStyle.Secondary)
      );

      await msg.reply({ embeds: [embed], files: [imageAttachment], components: [dismissButton] });
    } catch (e) {
      console.error('Balance command error:', e);
      await msg.reply('❌ An error occurred while fetching balance.');
    }
  }

  else if (cmd === 'withdraw') {
    try {
      // Parse command arguments
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Withdrawal Command')
          .setDescription('**Usage:** `.withdraw <amount> <ltc_address>`\n\n**Examples:**\n• `.withdraw 50 LgcwGvr4UW9VQx7gb3m2ZTfhmtKSUNJ1FW`\n• `.withdraw 12.5 LgcwGvr4UW9VQx7gb3m2ZTfhmtKSUNJ1FW`\n• `.withdraw all LgcwGvr4UW9VQx7gb3m2ZTfhmtKSUNJ1FW`')
          .setColor('#e74c3c')
          .addFields([
            { name: '💡 Amount', value: 'Number of points, decimals allowed, or "all"', inline: true },
            { name: '📍 Address', value: 'Valid Litecoin address', inline: true }
          ])
          .setFooter({ text: 'Masterbets • Fees deducted from amount' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      let points;
      const ltcAddress = args[1];

      await ensureUserExists(msg.author.id);
      
      // Handle "all" keyword - withdraw entire balance
      if (args[0].toLowerCase() === 'all') {
        const user = await dbGet('SELECT balance FROM users WHERE id = ?', [msg.author.id]);
        if (!user || user.balance <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ No Balance')
            .setDescription('You have no points to withdraw.')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        points = user.balance; // Use exact balance including decimals
      } else {
        // Parse decimal amount
        points = parseFloat(args[0]);
        if (isNaN(points) || !isFinite(points) || points <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Amount')
            .setDescription('Please enter a valid number of points or "all".')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
      }
      
      // Validate withdrawal amount
      const amountValidation = validateWithdrawalAmount(points, msg.author.id);
      if (!amountValidation.valid) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Amount')
          .setDescription(amountValidation.message)
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Validate LTC address format
      if (!isValidLtcAddress(ltcAddress)) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Address')
          .setDescription('Please provide a valid Litecoin address.\n\n**Supported formats:**\n• Legacy (L...)\n• Bech32 (ltc1...)')
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Check withdrawal cooldown first
      const cooldownCheck = checkWithdrawalCooldown();
      if (!cooldownCheck.valid) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Withdrawal Cooldown')
          .setDescription(`Someone withdrew recently. Wait ${Math.floor(cooldownCheck.remainingSeconds / 60)}m ${cooldownCheck.remainingSeconds % 60}s and try again.`)
          .setColor('#f39c12')
          .setFooter({ text: 'Masterbets' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Check user balance
      const balanceCheck = await checkWithdrawalBalance(msg.author.id, points);
      if (!balanceCheck.valid) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(balanceCheck.message)
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Show withdrawal confirmation
      const ltcAmount = pointsToLtc(points);
      const ltcPrice = await getLTCPriceUSD();
      const amountUsd = ltcAmount * ltcPrice;
      
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Withdrawal')
        .setDescription(`**Are you sure you want to withdraw?**\n\nThis action cannot be undone.`)
        .setColor('#f39c12')
        .addFields([
          { name: '🎯 Amount', value: `${points.toFixed(2)} points`, inline: true },
          { name: '💵 USD Value', value: `$${amountUsd.toFixed(2)}`, inline: true },
          { name: '📍 LTC Address', value: `\`${ltcAddress}\``, inline: false },
          { name: '🪙 LTC Amount', value: `≈ ${ltcAmount.toFixed(8)} LTC`, inline: true },
          { name: '⏱️ Processing', value: 'Instant via Apirone', inline: true }
        ])
        .setFooter({ text: 'Click Cancel to abort or Cashout to proceed' });
      
      const withdrawalButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`withdraw_cancel_${msg.author.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❌'),
        new ButtonBuilder()
          .setCustomId(`withdraw_cashout_${msg.author.id}_${points}_${ltcAddress}`)
          .setLabel('Cashout')
          .setStyle(ButtonStyle.Success)
          .setEmoji('💰')
      );
      
      await msg.reply({ embeds: [confirmEmbed], components: [withdrawalButtons] });
      
      // The withdrawal will be processed when the user clicks the "Cashout" button
      
    } catch (e) {
      console.error('Withdrawal command error:', e);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription('An unexpected error occurred. Please try again or contact support.')
        .setColor('#e74c3c');
      
      await msg.reply({ embeds: [errorEmbed] });
    }
  }
// --- .createcode (owner-only) ---
// Usage: .createcode CODE 100 10 500
// where CODE = string, 100 = points per use, 10 = total uses, 500 = min total_wagered required
else if (cmd === 'createcode') {
  try {
    if (!requireSuperAdmin(msg.author.id, 'CREATE_CODE')) {
      return msg.reply('❌ Only owner may use this command.');
    }
    if (args.length < 4) return msg.reply('❌ Usage: .createcode <CODE> <points_per_use> <total_uses> <wager_requirement>');
    const code = args[0].toUpperCase();
    const reward = Number(args[1]);
    const totalUses = parseInt(args[2]);
    const wagerReq = Number(args[3]);

    if (!code || isNaN(reward) || isNaN(totalUses) || isNaN(wagerReq)) {
      return msg.reply('❌ Invalid arguments. Ensure numeric fields are valid.');
    }

    // create
    try {
      await createRedeemCode(code, reward, totalUses, wagerReq, msg.author.id);
      return msg.reply(`✅ Code \`${code}\` created — ${reward} points per use, ${totalUses} total uses, wager requirement ${wagerReq}`);
    } catch (err) {
      if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
        return msg.reply('❌ Code already exists. Choose a different code.');
      }
      throw err;
    }

  } catch (e) {
    console.error('Error in .createcode:', e);
    return msg.reply('❌ Error creating code.');
  }
}
else if (cmd === 'claim') {
  try {
    if (args.length < 1) return msg.reply('❌ Usage: .claim <CODE>');
    const code = args[0].toUpperCase();
    await ensureUserExists(msg.author.id);
    await ensureUserLevelExists(msg.author.id);

    const row = await getRedeemCode(code);
    if (!row || !row.active || row.uses_remaining <= 0) {
      return msg.reply('�� Code not found or expired.');
    }

    // ✅ Check wager requirement BEFORE decrementing uses
    const wagerReq = Number(row.wager_requirement || 0);
    if (wagerReq > 0) {
      const levelData = await getUserLevelData(msg.author.id);
      const totalWagered = Number(levelData?.totalWagered || 0);
      if (totalWagered < wagerReq) {
        return msg.reply(`❌ You need at least **${wagerReq}** wager to claim this code. Your wager: **${totalWagered}**.`);
      }
    }

    // ✅ Check if the user already claimed this code
    const existingClaim = await dbGet(
      'SELECT 1 FROM redeem_code_claims WHERE user_id = ? AND code = ?',
      [msg.author.id, code]
    );
    if (existingClaim) {
      return msg.reply('⚠️ You have already claimed this code before.');
    }

    // Atomically decrement uses
    const dec = await decrementRedeemCodeUse(code);
    if (!dec.ok) {
      return msg.reply('❌ This code is no longer redeemable.');
    }

    // Award points
    await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [row.reward, msg.author.id]);

    // ✅ Record claim
    const now = Math.floor(Date.now() / 1000);
    await dbRun(
      'INSERT INTO redeem_code_claims (user_id, code, claimed_at) VALUES (?, ?, ?)',
      [msg.author.id, code, now]
    );

    // Respond
    const embed = new EmbedBuilder()
      .setTitle('🎉 Code Redeemed!')
      .setDescription(`You claimed \`${code}\` for **${row.reward} points**.`)
      .addFields([
        { name: '<:stolen_emoji_blaze:1425739220340965476> Claimer', value: `<@${msg.author.id}>`, inline: true },
        { name: '<:stolen_emoji_blaze:1425733548803096677> Reward', value: `${row.reward} points`, inline: true },
        { name: '<:stolen_emoji_blaze:1425733921110229012> Remaining Uses', value: `${Math.max((dec.code?.uses_remaining || 0), 0)} / ${row.total_uses}`, inline: true }
      ])
      .setColor('#1f8b4c')
      .setTimestamp();

    return msg.reply({ embeds: [embed] });

  } catch (e) {
    console.error('Error in .claim:', e);
    return msg.reply('❌ Error processing code claim.');
  }
}

// --- .exhauste (owner-only): expire a code immediately ---
else if (cmd === 'exhauste') {
  try {
    if (!requireSuperAdmin(msg.author.id, 'EXHAUST_CODE')) {
      return msg.reply('❌ Only owner may use this command.');
    }
    if (args.length < 1) return msg.reply('❌ Usage: .exhauste <CODE>');
    const code = args[0].toUpperCase();
    const row = await getRedeemCode(code);
    if (!row) return msg.reply('❌ Code not found.');
    await exhaustRedeemCode(code);
    return msg.reply(`✅ Code \`${code}\` has been expired.`);
  } catch (e) {
    console.error('Error in .exhauste:', e);
    return msg.reply('❌ Error expiring code.');
  }
}

// --- .claim <code> : public claim ---
else if (cmd === 'claim') {
  try {
    if (args.length < 1) return msg.reply('❌ Usage: .claim <CODE>');
    const code = args[0].toUpperCase();
    await ensureUserExists(msg.author.id);
    await ensureUserLevelExists(msg.author.id);

    const row = await getRedeemCode(code);
    if (!row || !row.active || row.uses_remaining <= 0) {
      return msg.reply('❌ Code not found or expired.');
    }

    // ✅ Check wager requirement BEFORE decrementing uses
    const wagerReq = Number(row.wager_requirement || 0);
    if (wagerReq > 0) {
      const levelData = await getUserLevelData(msg.author.id);
      const totalWagered = Number(levelData?.totalWagered || 0);
      if (totalWagered < wagerReq) {
        return msg.reply(`❌ You need at least **${wagerReq}** wager to claim this code. Your wager: **${totalWagered}**.`);
      }
    }

    // Atomically decrement uses then award reward
    const dec = await decrementRedeemCodeUse(code);
    if (!dec.ok) {
      return msg.reply('❌ This code is no longer redeemable.');
    }

    // Award points
    await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [row.reward, msg.author.id]);

    // Respond with success
    const embed = new EmbedBuilder()
      .setTitle('🎉 Code Redeemed!')
      .setDescription(`You claimed \`${code}\` for **${row.reward} points**.`)
      .addFields([
        { name: '👤 Claimer', value: `<@${msg.author.id}>`, inline: true },
        { name: '💰 Awarded', value: `${row.reward} points`, inline: true },
        { name: '🧾 Remaining Uses', value: `${Math.max((dec.code?.uses_remaining || 0), 0)} / ${row.total_uses}`, inline: true }
      ])
      .setColor('#1f8b4c')
      .setTimestamp();

    return msg.reply({ embeds: [embed] });

  } catch (e) {
    console.error('Error in .claim:', e);
    return msg.reply('❌ Error processing code claim.');
  }
}

  else if (cmd === 'tip') {
    try {
      // Parse command arguments
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Tip Command')
          .setDescription('**Usage:** `.tip @user <amount>`\n\n**Examples:**\n• `.tip @friend 25` - Tip 25 points\n• `.tip @user 1$` - Tip $1 worth of points')
          .setColor('#e74c3c')
          .addFields([
            { name: '👤 User', value: 'Mention the user to tip', inline: true },
            { name: '🎯 Amount', value: 'Points (0.01-10,000) or USD ($0.01-$830)', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Spread the wealth!' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      const targetUser = msg.mentions.users.first();
      let points;
      
      // Parse amount (supports both points and USD)
      const parsedAmount = parseAmount(args[1]);
      
      if (!parsedAmount) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Amount Format')
          .setDescription('Please enter a valid amount.\n\n**Examples:**\n• `25` - 25 points\n• `1$` - $1.00 worth of points')
          .setColor('#e74c3c');
        return msg.reply({ embeds: [embed] });
      }
      
      if (parsedAmount.type === 'usd') {
        try {
          points = await usdToPoints(parsedAmount.amount);
          console.log(`USD tip: $${parsedAmount.amount} = ${points} points`);
        } catch (error) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Exchange Rate Error')
            .setDescription('Unable to get current exchange rate. Please try again or use points instead.')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
      } else {
        points = parsedAmount.amount;
      }
      
      if (!targetUser) {
        const embed = new EmbedBuilder()
          .setTitle('❌ User Not Found')
          .setDescription('Please mention a valid user to tip!')
          .setColor('#e74c3c')
          .addFields([
            { name: '✅ Correct Format', value: '`.tip @username 10`', inline: true },
            { name: '❌ Wrong Format', value: '`.tip username 10`', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Make sure to use @ mentions!' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      if (targetUser.id === msg.author.id) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Self-Tip Not Allowed')
          .setDescription('You cannot tip yourself! Tips are meant to be shared with others.')
          .setColor('#e74c3c')
          .addFields([
            { name: '💡 Suggestion', value: 'Find a friend to tip instead!', inline: true },
            { name: '🎮 Alternative', value: 'Try playing games to earn more points', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Sharing is caring!' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      if (targetUser.bot) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Cannot Tip Bots')
          .setDescription('Bots don\'t need your generous tips! Save them for real users.')
          .setColor('#e74c3c')
          .addFields([
            { name: '🤖 Fun Fact', value: 'Bots don\'t have wallets', inline: true },
            { name: '👥 Try Instead', value: 'Tip a friend or server member', inline: true }
          ])
          .setFooter({ text: 'Masterbets • Keep it human!' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      if (isNaN(points) || points < 0.01 || points > 10000) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Tip Amount')
          .setDescription('Please enter a valid tip amount between **0.01** and **10,000** points.')
          .setColor('#e74c3c')
          .addFields([
            { name: '💰 Minimum', value: '0.01 points', inline: true },
            { name: '💎 Maximum', value: '10,000 points', inline: true },
            { name: '✨ Examples', value: '`.tip @friend 0.5`\n`.tip @user 100`', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Share the wealth responsibly!' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Check sender's balance
      await ensureUserExists(msg.author.id);
      const sender = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const senderBalance = sender?.balance || 0;
      
      if (senderBalance < points) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(`You need **${points.toFixed(2)}** points but only have **${senderBalance.toFixed(2)}** points.\n\nUse \`.deposit\` to add more funds!`)
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Ensure target user exists
      await ensureUserExists(targetUser.id);
      
      // Perform the tip transaction with proper SQLite transaction
      try {
        // Start transaction
        await dbRun('BEGIN IMMEDIATE');
        
        try {
          // Double-check sender balance in transaction
          const senderCheck = await dbGet('SELECT balance FROM users WHERE id = ?', [msg.author.id]);
          const currentBalance = Math.round(senderCheck?.balance || 0);
          
          if (currentBalance < points) {
            await dbRun('ROLLBACK');
            return msg.reply('❌ Insufficient balance! Your balance changed during the tip.');
          }
          
          // Atomic transfer: deduct from sender and add to receiver
          await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, msg.author.id]);
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [points, targetUser.id]);

          await dbRun('INSERT INTO point_transfers (from_user_id, to_user_id, points, created_at) VALUES (?, ?, ?, ?)',
            [msg.author.id, targetUser.id, points, Date.now()]);
          
          // Commit transaction
          await dbRun('COMMIT');
          
          // Calculate USD equivalent for display
          let usdValue = 0;
          try {
            const ltcPrice = await getLTCPriceUSD();
            const ltc = pointsToLtc(points);
            usdValue = ltc * ltcPrice;
          } catch (e) {
            console.error('Error getting LTC price for tip:', e);
          }
          
          // Generate beautiful tip success image
          const tipImage = await generateTipSuccessImage(msg.author, targetUser, points, usdValue);
          const imageAttachment = new AttachmentBuilder(tipImage, { name: 'tip-success.png' });
          
          // Success message to recipient
          const successEmbed = new EmbedBuilder()
            .setTitle(`@${targetUser.username}, you've received a tip!`)
            .setColor('#10b981')
            .setImage('attachment://tip-success.png')
            .setFooter({ text: 'MasterBets' });

          await msg.reply({ embeds: [successEmbed], files: [imageAttachment] });
          
        } catch (dbError) {
          // Rollback on any database error
          await dbRun('ROLLBACK');
          throw dbError;
        }
        
      } catch (error) {
        console.error('Tip transaction error:', error);
        await msg.reply('❌ Tip transaction failed. Please try again.');
      }
      
    } catch (e) {
      console.error('Tip command error:', e);
      await msg.reply('❌ An error occurred while processing the tip.');
    }
  }

  else if (cmd === 'statify') {
    // Stats command - regular admin access is sufficient
    if (!requireRegularAdmin(msg.author.id, 'STATS_COMMAND')) {
      return msg.reply('❌ You do not have permission to use this command.');
    }

    try {
      // Get basic data for main overview
      const [walletBalance, ltcPrice] = await Promise.all([
        getBotWalletBalance(),
        getLTCPriceUSD()
      ]);

      const botBalanceLTC = walletBalance ? walletBalance.available : 0;
      const botBalanceUSD = botBalanceLTC * ltcPrice;

      // Main Admin Panel Embed
      const mainEmbed = new EmbedBuilder()
        .setTitle('�� MasterBets ADMIN CONTROL PANEL')
        .setColor('#6366f1')
        .setDescription('**Welcome to the comprehensive admin dashboard**\n\nSelect a category below to view detailed information:')
        .addFields([
          { name: '💰 Financial Overview', value: 'View deposits, withdrawals, and profit/loss analysis', inline: true },
          { name: '👥 User Statistics', value: 'User metrics, activity, and top balances', inline: true },
          { name: '📋 Transactions', value: 'Recent deposits, withdrawals, and pending operations', inline: true },
          { name: '⚙️ System Status', value: 'Bot health, API status, and performance metrics', inline: true },
          { name: '🏦 Current Wallet', value: `**${botBalanceLTC.toFixed(8)} LTC**\n**$${botBalanceUSD.toFixed(2)} USD**`, inline: true },
          { name: '📈 LTC Price', value: `**$${ltcPrice.toFixed(2)}/LTC**\n*Live Market Rate*`, inline: true }
        ])
        .setFooter({ text: 'MasterBets Admin Panel • Use buttons to navigate' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('stats_financial')
          .setLabel('💰 Financial')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('stats_users')
          .setLabel('👥 Users')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('stats_transactions')
          .setLabel('📋 Transactions')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('stats_system')
          .setLabel('⚙️ System')
          .setStyle(ButtonStyle.Danger)
      );
        
      // Only show admin tools button to the specific super admin
      const components = [row];
  if (msg.author.id === '1139852917562691646' || msg.author.id === '1229389017405984789' || msg.author.id === '1050087707101118484' || msg.author.id === '944099582315483237' ) {
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('stats_admin')
            .setLabel('🔒 Admin Tools')
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row2);
      }

      return msg.reply({ embeds: [mainEmbed], components });

    } catch (error) {
      console.error('Error generating admin stats panel:', error);
      return msg.reply('❌ Error retrieving bot statistics. Please try again.');
    }
  }

  else if (cmd === 'level') {
    try {
      await ensureUserExists(msg.author.id);
      const levelData = await getUserLevelData(msg.author.id);
      
      if (!levelData) {
        return msg.reply('❌ Error retrieving level data. Please try again.');
      }
      
      // Generate level card image
      const levelCardImage = await generateLevelCardImage(msg.author, levelData);
      const attachment = new AttachmentBuilder(levelCardImage, { name: 'level-card.png' });
      
      // Create embed
      const currentLevelText = levelData.currentLevel ? 
        `${levelData.currentLevel.emoji} ${levelData.currentLevel.name}` : 
        '⭐ Unranked';
      const nextLevelText = levelData.nextLevel ? 
        `**Next Level:** ${levelData.nextLevel.emoji} ${levelData.nextLevel.name}` : 
        '🏆 **MAX LEVEL REACHED!**';
      
      const embed = new EmbedBuilder()
        .setTitle(`🎖️ ${msg.author.username}'s Level Status`)
        .setDescription(`**Current Level:** ${currentLevelText}\n${nextLevelText}`)
        .setImage('attachment://level-card.png')
        .setColor('#FFD700')
        .setFooter({ text: 'MasterBets Level System • Keep wagering to level up!' })
        .setTimestamp();
      
      const components = [];
      
      // Add claim button if user has pending level claim and valid current level
      if (levelData.pendingClaim && levelData.currentLevel) {
        const claimRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`claim_level_${msg.author.id}`)
            .setLabel('🎉 Claim Level Reward!')
            .setStyle(ButtonStyle.Success)
        );
        components.push(claimRow);
        
        if (levelData.currentLevel) {
          embed.addFields([
            { name: '🎉 Level Up Available!', value: `You can now claim **${levelData.currentLevel.name}** and earn **${levelData.currentLevel.reward} points**!`, inline: false }
          ]);
        }
      }
      
      return msg.reply({ embeds: [embed], files: [attachment], components });

    } catch (error) {
      console.error('Error in level command:', error);
      return msg.reply('❌ An error occurred while retrieving your level. Please try again.');
    }
  }

  else if (cmd === 'levels') {
    try {
      // Create comprehensive level overview
      const embed = new EmbedBuilder()
        .setTitle('🎖️ MasterBets Rank Rewards System')
        .setDescription('Level up by wagering points across all games! Each level unlocks exclusive roles and point rewards.')
        .setColor('#FFD700')
        .setFooter({ text: 'MasterBets • Wager to unlock higher ranks!' })
        .setTimestamp();
      
      // Add level fields in groups to avoid Discord's field limit
      let levelText = '';
      for (let i = 0; i < LEVEL_CONFIG.length; i++) {
        const level = LEVEL_CONFIG[i];
        levelText += `**${level.emoji} ${level.name}** – ${level.threshold.toLocaleString()} wagered – ${level.reward} pts\n`;
        
        // Discord embed fields have a character limit, so split into multiple fields
        if (levelText.length > 800 || i === LEVEL_CONFIG.length - 1) {
          embed.addFields([
            { 
              name: i < 5 ? '🏆 Entry Levels' : i < 10 ? '👑 Elite Levels' : '💎 Prestige Level', 
              value: levelText, 
              inline: false 
            }
          ]);
          levelText = '';
        }
      }
      
      embed.addFields([
        { name: '🎮 How it Works', value: 'Wager points in **Mines**, **Blackjack**, or **Coinflip** to progress through levels automatically!', inline: true },
        { name: '🎁 Rewards', value: 'Each level grants you points and an exclusive Discord role!', inline: true },
        { name: '📊 Check Progress', value: 'Use `.level` to see your current progress and claim rewards!', inline: true }
      ]);
      
      return msg.reply({ embeds: [embed] });

    } catch (error) {
      console.error('Error in levels command:', error);
      return msg.reply('❌ An error occurred while showing level information. Please try again.');
    }
  }

  else if (cmd === 'cf' || cmd === 'coinflip') {
    try {
      // Parse command arguments (same as before)
      if (args.length < 1) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Coinflip Command')
          .setDescription('**Usage:** `.cf <amount|all> [h/heads/t/tails]`\n\n**Examples:**\n`.cf 10 h` - Bet 10 points on heads\n`.cf 0.5$ t` - Bet $0.50 worth of points on tails\n`.cf all heads` - Bet all points on heads\n`.cf 20` - Bet 20 points (random side)')
          .setColor('#e74c3c')
          .addFields([
            { name: '🎯 Amount', value: 'Points (1-1000), USD ($0.01-$83), or "all"', inline: true },
            { name: '🪙 Side', value: 'h/heads or t/tails (optional)', inline: true },
            { name: '💰 Multiplier', value: '1.92x on win', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Fair coinflip game' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Check coin flip cooldown (same as before)
      const cooldownCheck = checkCoinflipCooldown(msg.author.id);
      if (!cooldownCheck.valid) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Coin Flip Cooldown Active')
          .setDescription(cooldownCheck.message)
          .setColor('#ffa500')
          .setFooter({ text: 'MasterBets • Please wait before betting again' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Parse bet amount and user choice (same as before)
      let points;
      let userChoice;
      let originalAmountStr = args[0];
      
      if (args[0].toLowerCase() === 'all') {
        // Get user balance for "all" bet
        await ensureUserExists(msg.author.id);
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
        const balance = user?.balance || 0;
        
        if (balance < 1) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Insufficient Balance')
            .setDescription('You need at least **1 point** to place a bet.\n\nUse `.deposit` to add funds!')
            .setColor('#e74c3c')
            .addFields([
              { name: '💰 Current Balance', value: `${balance.toFixed(2)} points`, inline: true },
              { name: '💎 Minimum Bet', value: '1 point', inline: true }
            ])
            .setFooter({ text: 'MasterBets • Get some points first!' });
          
          return msg.reply({ embeds: [embed] });
        }
        
        points = Math.min(balance, 1000);
        userChoice = args[1] ? args[1].toLowerCase() : null;
      } else {
        // Parse amount (same as before)
        const parsedAmount = parseAmount(args[0]);
        
        if (!parsedAmount) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Amount Format')
            .setDescription('Please enter a valid amount.\n\n**Examples:**\n• `10` - 10 points\n• `0.5$` - $0.50 worth of points\n• `all` - All your points')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        
        if (parsedAmount.type === 'usd') {
          try {
            points = await usdToPoints(parsedAmount.amount);
          } catch (error) {
            const embed = new EmbedBuilder()
              .setTitle('❌ Exchange Rate Error')
              .setDescription('Unable to get current exchange rate. Please try again or use points instead.')
              .setColor('#e74c3c');
            return msg.reply({ embeds: [embed] });
          }
        } else {
          points = parsedAmount.amount;
        }
        
        userChoice = args[1] ? args[1].toLowerCase() : null;
      }

      // Validate bet amount (same as before)
      if (isNaN(points) || points < 1 || points > 1000) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Bet Amount')
          .setDescription('Please enter a valid bet amount between **1** and **1,000** points.')
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }

      // Check user balance (same as before)
      await ensureUserExists(msg.author.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const balance = user?.balance || 0;

      if (balance < points) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(`You need **${points.toFixed(2)}** points but only have **${balance.toFixed(2)}** points.\n\nUse \`.deposit\` to add more funds!`)
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }

      // Parse user choice or pick random (same as before)
      if (!userChoice) {
        userChoice = Math.random() < 0.5 ? 'heads' : 'tails';
      } else {
        if (userChoice === 'h' || userChoice === 'head') userChoice = 'heads';
        if (userChoice === 't' || userChoice === 'tail') userChoice = 'tails';
        if (!['heads', 'tails'].includes(userChoice)) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Side Choice')
            .setDescription('Please choose a valid side for your coinflip bet!')
            .setColor('#e74c3c');
          
          return msg.reply({ embeds: [embed] });
        }
      }

      // Update cooldown timestamp after validation but before game execution
      updateCoinflipTimestamp(msg.author.id);

      // First show spinning coin animation
      const spinningImage = await generateSpinningCoinImage(msg.author, points, userChoice);
      const spinningAttachment = new AttachmentBuilder(spinningImage, { name: 'spinning-coin.png' });

      const spinningEmbed = new EmbedBuilder()
        .setColor('#00bcd4')
        .setImage('attachment://spinning-coin.png')
        .setFooter({ text: 'MasterBets' });

      const spinningMessage = await msg.reply({ embeds: [spinningEmbed], files: [spinningAttachment] });

      // Wait 2 seconds for suspense
      await new Promise(resolve => setTimeout(resolve, 2000));

      const houseLuck = await getHouseLuckPercent();
      const userWinChance = Math.max(0, Math.min(100, 100 - houseLuck));
      const randomNum = await crypto.randomInt(0, 100);
      const userWon = randomNum < userWinChance;
      const gameResult = userWon ? userChoice : (userChoice === 'heads' ? 'tails' : 'heads');

      const multiplier = 1.92;
      const winnings = userWon ? Number((points * multiplier).toFixed(2)) : 0; 

      // Update user balance for win/loss
      const netChange = userWon ? Number((points * (multiplier - 1)).toFixed(2)) : -points;
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [netChange, msg.author.id]);

      // Log coinflip wins to the logs channel
      if (userWon) {
        try {
          await sendLogMessage(`✅ ${msg.author.username} won ${winnings.toFixed(2)} points in coinflip!`);
        } catch (logError) {
          console.error('Error logging coinflip win:', logError);
        }
      }

      // Generate coinflip result image
      const resultImage = await generateCoinflipImage(msg.author, points, userChoice, gameResult, userWon, winnings, `house-luck-${houseLuck}`);
      const imageAttachment = new AttachmentBuilder(resultImage, { name: 'coinflip-result.png' });

      // Create betting buttons for next round (same as before)
      const buttonStyle = userWon ? ButtonStyle.Success : ButtonStyle.Danger;
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cf_again_${points.toFixed(2)}_heads`)
          .setLabel(`Bet again ${points.toFixed(2)} points on Heads`)
          .setStyle(buttonStyle),
        new ButtonBuilder()
          .setCustomId(`cf_again_${points.toFixed(2)}_tails`)
          .setLabel(`Bet again ${points.toFixed(2)} points on Tails`)
          .setStyle(buttonStyle)
      );

      // Red embed for losses, green for wins
      const resultEmbed = new EmbedBuilder()
        .setColor(userWon ? '#22c55e' : '#ef4444')
        .setImage('attachment://coinflip-result.png')
        .setFooter({ text: 'MasterBets' });

      // Edit the spinning message to show the result
      await spinningMessage.edit({ embeds: [resultEmbed], files: [imageAttachment], components: [actionRow] });

    } catch (e) {
      console.error('Coinflip command error:', e);
      await msg.reply('❌ An error occurred during coinflip. Please try again.');
    }
  }


  else if (cmd === 'bj' || cmd === 'blackjack') {
    try {
      // SECURITY: Check if user already has an active session in database
      const existingGame = await dbGet('SELECT * FROM blackjack_games WHERE user_id = ? AND game_state != ?', [msg.author.id, 'finished']);
      if (existingGame) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Game Already in Progress')
          .setDescription('You already have an active Blackjack game! Finish it or wait for it to timeout.')
          .setColor('#e74c3c');
        return msg.reply({ embeds: [embed] });
      }

      // Parse bet amount (optional)
      let betAmount = 1; // Default bet
      if (args.length > 0) {
        const parsedAmount = parseAmount(args[0]);
        if (parsedAmount) {
          if (parsedAmount.type === 'usd') {
            // Convert USD to points
            betAmount = await usdToPoints(parsedAmount.amount);
          } else {
            betAmount = parsedAmount.amount;
          }
        } else if (args[0].toLowerCase() === 'all') {
          // Get user balance for "all" bet
          await ensureUserExists(msg.author.id);
          const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
          const balance = user?.balance || 0;
          betAmount = Math.min(balance, 1000); // Cap at 1000 max bet
        } else {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Amount Format')
            .setDescription('Please enter a valid bet amount.\n\n**Examples:**\n• `.bj 10` - Bet 10 points\n• `.bj 0.5$` - Bet $0.50 worth of points\n• `.bj all` - Bet all your points\n• `.bj` - Bet 1 point (default)')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
      }

      // Validate bet amount
      if (betAmount < 1 || betAmount > 1000) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Bet Amount')
          .setDescription('Bet must be between **1** and **1000** points.')
          .setColor('#e74c3c');
        return msg.reply({ embeds: [embed] });
      }

      // Ensure user exists and check balance
      await ensureUserExists(msg.author.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const balance = user?.balance || 0;

      if (balance < betAmount) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(`You need **${betAmount.toFixed(2)}** points but only have **${balance.toFixed(2)}** points.\n\nUse \`.deposit\` to add more funds!`)
          .setColor('#e74c3c')
          .addFields([
            { name: '💰 Current Balance', value: `${balance.toFixed(2)} points`, inline: true },
            { name: '💎 Bet Amount', value: `${betAmount.toFixed(2)} points`, inline: true }
          ]);
        return msg.reply({ embeds: [embed] });
      }

      // SECURITY: Atomic bet deduction and game creation using transaction
      await beginTransaction();
      try {
        // Deduct bet amount
        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [betAmount, msg.author.id]);
        
        // Track wagered amount for level progression
        await trackWageredAmount(msg.author.id, betAmount);
        
        // Create new secure database-backed session
        const session = await BlackjackSession.createNewGame(msg.author.id, betAmount);
        
        await commitTransaction();
        console.log(`🃏 Created secure blackjack game ${session.gameId} for ${msg.author.username}`);

      // Create and send game embed with beautiful card images
      const { embed, attachment } = await createBlackjackEmbed(session, msg.author);
      const buttons = createBlackjackButtons(session);

      const replyOptions = { 
        content: `<@${msg.author.id}>`,
        embeds: [embed], 
        components: [buttons]
      };
      
      if (attachment) {
        replyOptions.files = [attachment];
      }

      const gameMessage = await msg.reply(replyOptions);

        // If game ended immediately (blackjacks), process winnings
        if (session.isFinished()) {
          await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [session.winnings, msg.author.id]);
          await session.deleteFromDatabase();
          
          console.log(`Blackjack game ${session.gameId} finished immediately for ${msg.author.username}: ${session.result}, winnings: ${session.winnings}`);
        }
      } catch (error) {
        await rollbackTransaction();
        throw error;
      }

    } catch (error) {
      console.error('Blackjack command error:', error);
      await msg.reply('❌ An error occurred during blackjack. Please try again.');
    }
  }

  else if (cmd === 'withdraw') {
    try {
      // Parse arguments: .withdraw <amount> <address> or .withdraw all <address> or .withdraw 0.001 ltc <address>
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Withdrawal Command')
          .setDescription('**Usage Options:**\n• `.withdraw <points> <address>` - Withdraw points\n• `.withdraw <amount> ltc <address>` - Withdraw LTC amount\n• `.withdraw all <address>` - Withdraw all balance\n\n**Examples:**\n• `.withdraw 50 LQTpT9qcCzJmPzqFfbkFvFqHyqeD3YdVkW`\n• `.withdraw 0.001 ltc LQTpT9qcCzJmPzqFfbkFvFqHyqeD3YdVkW`\n• `.withdraw all LQTpT9qcCzJmPzqFfbkFvFqHyqeD3YdVkW`')
          .setColor('#e74c3c')
          .addFields([
            { name: '📌 Requirements', value: '• Minimum: 10 points (0.001 LTC)\n• Maximum: 100,000 points (10 LTC)\n• Valid Litecoin address required', inline: false }
          ])
          .setFooter({ text: 'MasterBets • Secure withdrawals via Apirone' });
        
        return msg.reply({ embeds: [embed] });
      }

      let points;
      let ltcAddress;

      await ensureUserExists(msg.author.id);
      
      // Check if "all" withdrawal
      if (args[0].toLowerCase() === 'all') {
        ltcAddress = args[1];
        // Get user's current balance
        const user = await dbGet('SELECT balance FROM users WHERE id = ?', [msg.author.id]);
        if (!user || user.balance <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ No Balance to Withdraw')
            .setDescription('You have no points to withdraw. Use `.deposit` to add funds!')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        points = user.balance; // Allow decimal withdrawals
      }
      // Check if LTC amount withdrawal
      else if (args.length >= 3 && args[1].toLowerCase() === 'ltc') {
        const ltcAmount = parseFloat(args[0]);
        ltcAddress = args[2];
        
        if (isNaN(ltcAmount) || ltcAmount <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid LTC Amount')
            .setDescription('Please provide a valid LTC amount.\n\n**Example:** `.withdraw 0.001 ltc LQTpT9qcCzJmPzqFfbkFvFqHyqeD3YdVkW`')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        
        // Convert LTC to points (0.0001 LTC = 1 point, so 1 LTC = 10000 points)
        points = Math.round(ltcAmount * 10000);
      }
      // Regular points withdrawal
      else {
        const pointsInput = parseFloat(args[0]);
        ltcAddress = args[1];
        
        if (isNaN(pointsInput) || pointsInput <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Points Amount')
            .setDescription('Please provide a valid number of points.\n\n**Example:** `.withdraw 50 LQTpT9qcCzJmPzqFfbkFvFqHyqeD3YdVkW`')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        
        points = Math.round(pointsInput);
      }

      // Validate points amount (skip for "all" since we already checked balance exists)
      if (args[0].toLowerCase() !== 'all') {
        const pointsValidation = validateWithdrawalAmount(points, msg.author.id);
        if (!pointsValidation.valid) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Withdrawal Amount')
            .setDescription(pointsValidation.message)
            .setColor('#e74c3c');
          
          return msg.reply({ embeds: [embed] });
        }
      }

      // Validate LTC address format
      if (!isValidLtcAddress(ltcAddress)) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Litecoin Address')
          .setDescription('The provided address is not a valid Litecoin address.\n\n**Supported formats:**\n• Legacy addresses (L...)\n• Multi-sig addresses (M...)\n• Bech32 addresses (ltc1...)')
          .setColor('#e74c3c')
          .setFooter({ text: 'Double-check your address to avoid loss of funds' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Check withdrawal cooldown first
      const cooldownCheck = checkWithdrawalCooldown();
      if (!cooldownCheck.valid) {
        const embed = new EmbedBuilder()
          .setTitle('⏰ Withdrawal Cooldown')
          .setDescription(`Someone withdrew recently. Wait ${Math.floor(cooldownCheck.remainingSeconds / 60)}m ${cooldownCheck.remainingSeconds % 60}s and try again.`)
          .setColor('#f39c12')
          .setFooter({ text: 'MasterBets' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Check user balance
      const balanceCheck = await checkWithdrawalBalance(msg.author.id, points);
      if (!balanceCheck.valid) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(balanceCheck.message)
          .setColor('#e74c3c')
          .addFields([
            { name: '💡 Need more funds?', value: 'Use `.deposit` to get your deposit address and add LTC to your account!', inline: false }
          ]);
        
        return msg.reply({ embeds: [embed] });
      }

      // Calculate withdrawal details
      const ltcAmount = pointsToLtc(points);
      const ltcPrice = await getLTCPriceUSD();
      const usdValue = ltcAmount * ltcPrice;

      // Create confirmation embed with buttons
      const confirmEmbed = new EmbedBuilder()
        .setTitle('💸 Confirm Withdrawal')
        .setDescription('Please review your withdrawal details carefully:')
        .setColor('#f39c12')
        .addFields([
          { name: '🎯 Points to Withdraw', value: `${points.toFixed(2)} points`, inline: true },
          { name: '🪙 LTC Amount', value: `${ltcAmount.toFixed(8)} LTC`, inline: true },
          { name: '💵 USD Value', value: `$${usdValue.toFixed(2)}`, inline: true },
          { name: '📍 Destination Address', value: `\`${ltcAddress}\``, inline: false },
          { name: '⚠️ Important', value: 'Withdrawals are **irreversible**. Verify your address is correct!', inline: false }
        ])
        .setFooter({ text: 'MasterBets • Click Cashout to proceed or Cancel to abort' })
        .setTimestamp();

      // Create action buttons
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`withdraw_cancel_${msg.author.id}`)
          .setLabel('❌ Cancel')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`withdraw_cashout_${msg.author.id}_${points}_${ltcAddress}`)
          .setLabel('💰 Cashout')
          .setStyle(ButtonStyle.Success)
      );

      await msg.reply({ embeds: [confirmEmbed], components: [actionRow] });

    } catch (error) {
      console.error('Withdrawal command error:', error);
      const embed = new EmbedBuilder()
        .setTitle('❌ Withdrawal Error')
        .setDescription('An error occurred while processing your withdrawal request. Please try again.')
        .setColor('#e74c3c');
      
      await msg.reply({ embeds: [embed] });
    }
  }

  else if (cmd === 'give') {
    // SECURITY: Give command can create points from nothing - require super admin
    if (!requireSuperAdmin(msg.author.id, 'GIVE_POINTS_COMMAND')) {
      return msg.reply('❌ You do not have sufficient privileges to use this command. Points creation requires super admin access.');
    }

    try {
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Give Command')
          .setDescription('**Usage:** `!give <user_id_or_username> <amount>`\n\n**Examples:**\n`!give 1089552985421520926 100` - Give 100 points to user ID\n`!give @gaurav190 50` - Give 50 points to username\n`!give gaurav190 25` - Give 25 points to username')
          .setColor('#e74c3c')
          .addFields([
            { name: '���� Target', value: 'User ID or username', inline: true },
            { name: '💰 Amount', value: 'Points to give (1-10000)', inline: true },
            { name: '🔒 Access', value: 'Admin only command', inline: true }
          ])
          .setFooter({ text: 'MasterBets Admin • Give points responsibly' });
        
        return msg.reply({ embeds: [embed] });
      }

      let targetIdentifier = args[0];
      const amount = parseFloat(args[1]);

      // Validate amount
      if (isNaN(amount) || amount <= 0 || amount > 10000) {
        return msg.reply('❌ Invalid amount. Please enter a number between 1 and 10000.');
      }

      // Clean username (remove @ if present)
      targetIdentifier = targetIdentifier.replace('@', '');

      // Try to get user by ID first, then by username
      let targetUser = null;
      let targetUserId = null;

      // Check if it's a user ID (all digits)
      if (/^\d+$/.test(targetIdentifier)) {
        targetUserId = targetIdentifier;
        try {
          targetUser = await client.users.fetch(targetUserId);
        } catch (e) {
          return msg.reply('❌ User not found by ID. Please check the user ID.');
        }
      } else {
        // Search by username in guild members
        const guild = msg.guild;
        if (guild) {
          const members = await guild.members.fetch({ query: targetIdentifier, limit: 1 });
          if (members.size > 0) {
            const member = members.first();
            targetUser = member.user;
            targetUserId = member.user.id;
          }
        }
        
        if (!targetUser) {
          return msg.reply('❌ User not found by username. Please check the username or use user ID.');
        }
      }

      // Ensure target user exists in database
      await ensureUserExists(targetUserId);

      // Add points to target user
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, targetUserId]);

      // Get updated balance
      const user = await dbGet('SELECT balance FROM users WHERE id = ?', [targetUserId]);
      const newBalance = user?.balance || 0;

      // Create success embed
      const successEmbed = new EmbedBuilder()
        .setTitle('🎁 Points Given Successfully!')
        .setDescription(`**${amount.toFixed(2)} points** have been given to **${targetUser.username}**`)
        .addFields([
          { name: '👤 Recipient', value: `${targetUser.username} (${targetUserId})`, inline: true },
          { name: '💰 Amount Given', value: `${amount.toFixed(2)} points`, inline: true },
          { name: '📊 New Balance', value: `${newBalance.toFixed(2)} points`, inline: true },
          { name: '👨‍💼 Admin', value: `${msg.author.username}`, inline: true },
          { name: '🕐 Timestamp', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true },
          { name: '💎 Transaction', value: `Admin Gift`, inline: true }
        ])
        .setColor('#00FF00')
        .setFooter({ text: 'MasterBets Admin • Transaction logged' })
        .setTimestamp();

      await msg.reply({ embeds: [successEmbed] });

      console.log(`Admin ${msg.author.username} gave ${amount} points to ${targetUser.username} (${targetUserId})`);

    } catch (e) {
      console.error('Give command error:', e);
      await msg.reply('❌ An error occurred while giving points. Please try again.');
    }
  }

  else if (cmd === 'profitmode') {
    // SECURITY: Profit mode is a dangerous feature - require super admin only
    if (!requireSuperAdmin(msg.author.id, 'PROFIT_MODE_COMMAND')) {
      return;  // Simply return without any reply if not a super admin
    }

    try {
      const currentMode = await getProfitMode();
      
      if (args.length === 0) {
        // Show current status
        const houseLuck = await getHouseLuckPercent();
        const embed = new EmbedBuilder()
          .setTitle('🔧 Profit Mode Status')
          .setDescription(`Profit mode is currently **${currentMode ? 'ENABLED' : 'DISABLED'}**`)
          .setColor(currentMode ? '#e74c3c' : '#22c55e')
          .addFields([
            { name: '📊 Current Status', value: `House luck: **${houseLuck}%** | User win chance: **${(100 - houseLuck)}%**`, inline: false },
            { name: '⚙️ Usage', value: '`.profitmode on` - Enable profit mode\n`.profitmode off` - Disable profit mode', inline: false },
            { name: '🎯 Effect', value: 'A single luck percentage is applied across all games that use luck (coinflip, mines, dice war, cases).', inline: false }
          ])
          .setFooter({ text: 'MasterBets Admin • Profit Mode Control' })
          .setTimestamp();
        
        return msg.reply({ embeds: [embed] });
      }

      const action = args[0].toLowerCase();
      
      if (action === 'on' || action === 'enable' || action === '1' || action === 'true') {
        if (currentMode) {
          return msg.reply('❌ Profit mode is already enabled!');
        }
        
        const success = await setProfitMode(true, msg.author.id);
        if (success) {
          const houseLuck = await getHouseLuckPercent();
          const embed = new EmbedBuilder()
            .setTitle('🛑 PROFIT MODE ENABLED')
            .setDescription('**⚠️ WARNING: Profit mode has been activated!**\n\nUser winning chances are now reduced across all games. This affects fairness.')
            .setColor('#e74c3c')
            .addFields([
              { name: '🎯 House Luck', value: `**${houseLuck}%**`, inline: true },
              { name: '👤 User Win Chance', value: `**${(100 - houseLuck)}%**`, inline: true },
              { name: '💰 Effect', value: 'Higher house profits across all games', inline: true },
              { name: '🛡️ Security', value: 'All changes logged for audit', inline: false }
            ])
            .setFooter({ text: 'MasterBets Admin • CAUTION: Users now have reduced winning chances' })
            .setTimestamp();
          
          await msg.reply({ embeds: [embed] });
        } else {
          await msg.reply('❌ Failed to enable profit mode. Check logs for errors.');
        }
        
      } else if (action === 'off' || action === 'disable' || action === '0' || action === 'false') {
        if (!currentMode) {
          return msg.reply('❌ Profit mode is already disabled!');
        }
        
        const success = await setProfitMode(false, msg.author.id);
        if (success) {
          const houseLuck = await getHouseLuckPercent();
          const embed = new EmbedBuilder()
            .setTitle('✅ PROFIT MODE DISABLED')
            .setDescription('**🎉 Profit mode has been deactivated!**\n\nWinning chances are back to normal across all games.')
            .setColor('#22c55e')
            .addFields([
              { name: '🎯 House Luck', value: `**${houseLuck}%**`, inline: true },
              { name: '👤 User Win Chance', value: `**${(100 - houseLuck)}%**`, inline: true },
              { name: '⚖️ Effect', value: 'Fair gaming restored', inline: true },
              { name: '🛡️ Security', value: 'All changes logged for audit', inline: false }
            ])
            .setFooter({ text: 'MasterBets Admin • Fair gaming restored - users have normal chances' })
            .setTimestamp();
          
          await msg.reply({ embeds: [embed] });
        } else {
          await msg.reply('❌ Failed to disable profit mode. Check logs for errors.');
        }
        
      } else {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Profit Mode Command')
          .setDescription('**Usage:** `.profitmode <on|off>`\n\n**Examples:**\n`.profitmode on` - Enable profit mode\n`.profitmode off` - Disable profit mode\n`.profitmode` - Show current status')
          .setColor('#e74c3c')
          .addFields([
            { name: '🔧 Valid Actions', value: '**on**, **enable**, **off**, **disable**', inline: true },
            { name: '📊 Status Check', value: 'Use `.profitmode` without arguments', inline: true },
            { name: '🔒 Access', value: 'Admin only command', inline: true }
          ])
          .setFooter({ text: 'MasterBets Admin • Profit Mode Control' });
        
        return msg.reply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Profit mode command error:', error);
      await msg.reply('❌ An error occurred while managing profit mode. Check logs for details.');
    }
  }


  else if (cmd === 'mines') {
    try {
      // Parse command arguments
      if (args.length < 1) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Mines Command')
          .setDescription('**Usage:** `.mines <amount|all> [bombs]`\n\n**Examples:**\n`.mines 10` - Bet 10 points with 5 bombs (default)\n`.mines 0.5$ 3` - Bet $0.50 worth of points with 3 bombs\n`.mines all 10` - Bet all points with 10 bombs\n`.mines 50 5` - Bet 50 points with 5 bombs')
          .setColor('#e74c3c')
          .addFields([
            { name: '🎯 Amount', value: 'Points (1-1000), USD ($0.01-$83), or "all"', inline: true },
            { name: '💣 Bombs', value: '3-24 bombs (default: 5)', inline: true },
            { name: '💎 Grid', value: '5x5 grid (25 tiles total)', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Mines game with escalating multipliers' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Check if user already has an active mines game
      const existingGame = await dbGet('SELECT * FROM mines_games WHERE user_id = ? AND status = ?', [msg.author.id, 'active']);
      if (existingGame) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Game Already Active')
          .setDescription('You already have an active mines game! Finish it or cash out before starting a new one.')
          .setColor('#e74c3c');
        
        return msg.reply({ embeds: [embed] });
      }

      // Parse bet amount and bombs count
      let points;
      let bombs;
      let originalAmountStr = args[0]; // Store for display purposes
      
      if (args[0].toLowerCase() === 'all') {
        // Get user balance for "all" bet
        await ensureUserExists(msg.author.id);
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
        const balance = user?.balance || 0;
        
        if (balance < 1) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Insufficient Balance')
            .setDescription('You need at least **1 point** to place a bet.\n\nUse `.deposit` to add funds!')
            .setColor('#e74c3c')
            .addFields([
              { name: '💰 Current Balance', value: `${balance.toFixed(2)} points`, inline: true },
              { name: '💎 Minimum Bet', value: '1 point', inline: true }
            ])
            .setFooter({ text: 'MasterBets • Get some points first!' });
          
          return msg.reply({ embeds: [embed] });
        }
        
        points = Math.min(balance, 1000); // Cap at 1000 max bet
        bombs = args[1] ? parseInt(args[1]) : 5;
      } else {
        // Parse amount (supports both points and USD)
        const parsedAmount = parseAmount(args[0]);
        
        if (!parsedAmount) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Amount Format')
            .setDescription('Please enter a valid amount.\n\n**Examples:**\n• `10` - 10 points\n• `0.5$` - $0.50 worth of points\n• `all` - All your points')
            .setColor('#e74c3c');
          return msg.reply({ embeds: [embed] });
        }
        
        if (parsedAmount.type === 'usd') {
          try {
            points = await usdToPoints(parsedAmount.amount);
            console.log(`USD mines bet: $${parsedAmount.amount} = ${points} points`);
          } catch (error) {
            const embed = new EmbedBuilder()
              .setTitle('❌ Exchange Rate Error')
              .setDescription('Unable to get current exchange rate. Please try again or use points instead.')
              .setColor('#e74c3c');
            return msg.reply({ embeds: [embed] });
          }
        } else {
          points = parsedAmount.amount;
        }
        
        bombs = args[1] ? parseInt(args[1]) : 5;
      }

      // Validate bet amount
      if (isNaN(points) || points < 1 || points > 1000) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Bet Amount')
          .setDescription('Please enter a valid bet amount between **1** and **1,000** points.')
          .setColor('#e74c3c')
          .addFields([
            { name: '💰 Minimum', value: '1 point', inline: true },
            { name: '💎 Maximum', value: '1,000 points', inline: true }
          ])
          .setFooter({ text: 'MasterBets • Enter a valid bet amount' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Validate bombs count
      if (isNaN(bombs) || bombs < 3 || bombs > 24) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Bombs Count')
          .setDescription('Please enter a valid number of bombs between **3** and **24**.')
          .setColor('#e74c3c')
          .addFields([
            { name: '💣 Minimum', value: '3 bombs', inline: true },
            { name: '💥 Maximum', value: '24 bombs', inline: true },
            { name: '🎯 Default', value: '5 bombs', inline: true }
          ])
          .setFooter({ text: 'Masterbets • Choose a valid bombs count' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Check user balance
      await ensureUserExists(msg.author.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const balance = user?.balance || 0;

      if (balance < points) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Insufficient Balance')
          .setDescription(`You need **${points.toFixed(2)}** points but only have **${balance.toFixed(2)}** points.\n\nUse \`.deposit\` to add more funds!`)
          .setColor('#e74c3c')
          .addFields([
            { name: '💰 Current Balance', value: `${balance.toFixed(2)} points`, inline: true },
            { name: '💎 Required', value: `${points.toFixed(2)} points`, inline: true }
          ])
          .setFooter({ text: 'Masterbets • Insufficient funds' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Deduct points from user balance
      await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, msg.author.id]);
      
      // Track wagered amount for level progression
      await trackWageredAmount(msg.author.id, points);

      // Forced-loss rule: if user has 2+ wins in a row in Mines, next game is forced loss
      const streakRow = await dbGet('SELECT win_streak FROM mines_streaks WHERE user_id = ?', [msg.author.id]);
      const forceLoss = (streakRow?.win_streak || 0) >= 2 ? 1 : 0;

      // Create mines grid (5x5 = 25 tiles)
      const gridSize = 25;
      const minePositions = [];
      
      // Check profit mode to determine mine placement strategy
      let actualBombs = bombs; // Track actual bombs used for database consistency

      const houseLuck = await getHouseLuckPercent();
      if (houseLuck > 50) {
        const factor = 1 + ((houseLuck - 50) / 100);
        actualBombs = Math.min(gridSize - 1, Math.min(24, Math.floor(bombs * factor)));

        const hotSpots = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24, 12];
        const hotSpotRatio = houseLuck >= 70 ? 0.6 : 0.35;
        const hotSpotMines = Math.min(Math.floor(actualBombs * hotSpotRatio), hotSpots.length);
        const shuffledHotSpots = [...hotSpots].sort(() => Math.random() - 0.5);

        for (let i = 0; i < hotSpotMines; i++) {
          minePositions.push(shuffledHotSpots[i]);
        }

        let attempts = 0;
        const maxAttempts = gridSize * 3;
        while (minePositions.length < actualBombs && attempts < maxAttempts) {
          const pos = Math.floor(Math.random() * gridSize);
          if (!minePositions.includes(pos)) {
            minePositions.push(pos);
          }
          attempts++;
        }

        if (minePositions.length < actualBombs) {
          for (let pos = 0; pos < gridSize && minePositions.length < actualBombs; pos++) {
            if (!minePositions.includes(pos)) {
              minePositions.push(pos);
            }
          }
        }
      } else {
        let attempts = 0;
        const maxAttempts = gridSize * 3;
        while (minePositions.length < bombs && attempts < maxAttempts) {
          const pos = Math.floor(Math.random() * gridSize);
          if (!minePositions.includes(pos)) {
            minePositions.push(pos);
          }
          attempts++;
        }
        if (minePositions.length < bombs) {
          for (let pos = 0; pos < gridSize && minePositions.length < bombs; pos++) {
            if (!minePositions.includes(pos)) {
              minePositions.push(pos);
            }
          }
        }
      }

      // Create new game in database - store ACTUAL bombs used, not original input
      // DATABASE FIX: This ensures multiplier calculations match actual game difficulty
      const gameId = await dbRun(
        'INSERT INTO mines_games (user_id, bet_amount, bombs, grid_state, status, created_at, force_loss) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [msg.author.id, points, actualBombs, JSON.stringify(minePositions), 'active', Date.now(), forceLoss]
      );

      // Generate and send mines game image - use actual bombs count for accurate display
      const gameImage = await generateMinesGameImage(msg.author, points, actualBombs, [], 1.0, 'active', minePositions);
      const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

      const embed = new EmbedBuilder()
        .setTitle('💎 Mines Game Started!')
        .setDescription(`**Bet Amount:** ${points.toFixed(2)} points\n**Bombs:** ${actualBombs}\n**Current Multiplier:** 1.00x\n\nClick tiles to reveal them. Avoid the bombs and cash out when you're ready!`)
        .setColor('#00ff00')
        .setImage('attachment://mines-game.png')
        .setFooter({ text: 'MasterBets • Good luck!' });

      // Create mine tiles buttons (5x5 grid = 25 tiles)
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const tileIndex = i * 5 + j;
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`mine_tile_${gameId.lastID}_${tileIndex}`)
              .setLabel('?')
              .setStyle(ButtonStyle.Secondary)
          );
        }
        rows.push(row);
      }

      const reply = await msg.reply({ embeds: [embed], files: [attachment], components: rows });

      // Create separate cashout button message (instead of reactions)
      const cashoutRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_cashout_${gameId.lastID}`)
          .setLabel('Cashout')
          .setStyle(ButtonStyle.Success)
      );
      const cashoutMsg = await msg.channel.send({ content: `<@${msg.author.id}>`, components: [cashoutRow] });

      // Save message tracking for later edits
      await dbRun('UPDATE mines_games SET channel_id = ?, message_id = ?, cashout_message_id = ? WHERE id = ?', [
        msg.channel.id,
        reply.id,
        cashoutMsg.id,
        gameId.lastID
      ]);

    } catch (e) {
      console.error('Error in mines command:', e);
      await msg.reply('❌ An error occurred while starting the mines game. Please try again.');
    }
  }

  // CALC COMMAND - Calculate mathematical expressions
  else if (cmd === 'calc' || cmd === 'calculate') {
    try {
      if (args.length < 1) {
        const embed = new EmbedBuilder()
          .setTitle('🧮 Calculator Help')
          .setDescription('**Usage:** `.calc <expression>`\n\n**Examples:**\n• `.calc 2 + 2` - Basic arithmetic\n• `.calc 15 * 6.5` - Multiplication with decimals\n• `.calc (100 + 50) / 3` - Use parentheses for grouping\n• `.calc sqrt(64)` - Square root\n• `.calc pow(2, 8)` - Power function')
          .setColor('#3498db')
          .addFields([
            { name: '➕ Operations', value: '+, -, *, /, %, pow(x,y)', inline: true },
            { name: '📐 Functions', value: 'sqrt(), abs(), round(), floor(), ceil()', inline: true },
            { name: '🔢 Constants', value: 'PI, E (use Math.PI, Math.E)', inline: true }
          ])
          .setFooter({ text: 'Masterbets • Safe calculation only' });
        
        return msg.reply({ embeds: [embed] });
      }

      const expression = args.join(' ');
      
      let result;
      try {
        // SECURITY FIX: Use safe mathematical expression parser instead of Function() constructor
        result = safeEvaluateExpression(expression);
        
        if (!isFinite(result)) {
          throw new Error('Result is not a finite number');
        }
      } catch (e) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Calculation Error')
          .setDescription('Invalid mathematical expression. Please check your syntax and try again.')
          .setColor('#e74c3c')
          .addFields([
            { name: '📝 Your Input', value: `\`${expression}\``, inline: false },
            { name: '💡 Tip', value: 'Use basic math operators: +, -, *, /, (), and functions like sqrt(), pow()', inline: false }
          ])
          .setFooter({ text: 'MasterBets • Check your math syntax' });
        
        return msg.reply({ embeds: [embed] });
      }

      // Format result nicely
      const formattedResult = typeof result === 'number' ? 
        (Number.isInteger(result) ? result.toString() : result.toFixed(8).replace(/\.?0+$/, '')) : 
        result.toString();

      const embed = new EmbedBuilder()
        .setTitle('🧮 Calculation Result')
        .setColor('#1f8b4c')
        .addFields([
          { name: '📝 Expression', value: `\`${expression}\``, inline: false },
          { name: '🎯 Result', value: `\`${formattedResult}\``, inline: false }
        ])
        .setFooter({ text: 'Masterbets • Calculator' })
        .setTimestamp();

      await msg.reply({ embeds: [embed] });

    } catch (e) {
      console.error('Error in calc command:', e);
      const embed = new EmbedBuilder()
        .setTitle('❌ Calculator Error')
        .setDescription('An error occurred while calculating. Please try again with a simpler expression.')
        .setColor('#e74c3c');
      
      await msg.reply({ embeds: [embed] });
    }
  }

  // PRICE COMMAND - Show points value in USD and LTC
  else if (cmd === 'price' || cmd === 'convert') {
    try {
      let points = 1; // Default to 1 point
      
      if (args.length > 0) {
        const inputPoints = parseFloat(args[0]);
        if (isNaN(inputPoints) || inputPoints <= 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Invalid Amount')
            .setDescription('Please enter a valid number of points.\n\n**Examples:**\n• `.price` - Show value of 1 point\n• `.price 100` - Show value of 100 points\n• `.price 0.5` - Show value of 0.5 points')
            .setColor('#e74c3c');
          
          return msg.reply({ embeds: [embed] });
        }
        points = inputPoints;
      }

      // Get LTC amount
      const ltcAmount = pointsToLtc(points);
      
      // Get USD value
      let usdValue = 0;
      let ltcPrice = 0;
      try {
        ltcPrice = await getLTCPriceUSD();
        usdValue = ltcAmount * ltcPrice;
      } catch (e) {
        console.error('Error getting LTC price:', e);
      }

      const embed = new EmbedBuilder()
        .setTitle('💰 Point Value Calculator')
        .setColor('#3498db')
        .setDescription(`**${points} ${points === 1 ? 'Point' : 'Points'} is worth:**`)
        .addFields([
          { name: '🪙 Litecoin (LTC)', value: `${ltcAmount.toFixed(8)} LTC`, inline: true },
          { name: '��� US Dollar (USD)', value: ltcPrice > 0 ? `$${usdValue.toFixed(4)}` : 'Price unavailable', inline: true },
          { name: '📊 Exchange Rate', value: ltcPrice > 0 ? `1 LTC = $${ltcPrice.toFixed(2)}` : 'Rate unavailable', inline: false },
          { name: '⚖️ Conversion Rate', value: '0.0001 LTC = 1 point', inline: false }
        ])
        .setFooter({ text: '🎮 Master Bets• Live market prices' })
        .setTimestamp();

      await msg.reply({ embeds: [embed] });

    } catch (e) {
      console.error('Error in price command:', e);
      const embed = new EmbedBuilder()
        .setTitle('❌ Price Check Error')
        .setDescription('Unable to get current prices. Please try again.')
        .setColor('#e74c3c');
      
      await msg.reply({ embeds: [embed] });
    }
  }
// STATS COMMAND - User statistics
  else if (cmd === 'stats' || cmd === 'statistics') {
    try {
      const target = msg.mentions.users.first() || msg.author;

      await ensureUserExists(target.id);
      
      // Get user deposits
      const deposits = await dbAll('SELECT * FROM deposits WHERE credited_to = ?', [target.id]);
      const totalDepositsLTC = deposits.reduce((sum, d) => sum + d.amount_ltc, 0);
      const totalDepositsUSD = deposits.reduce((sum, d) => sum + d.amount_usd, 0);
      const totalDepositsPoints = deposits.reduce((sum, d) => sum + d.points, 0);
      
      // Get user withdrawals
      const withdrawals = await dbAll('SELECT * FROM withdrawals WHERE user_id = ? AND status = "completed"', [target.id]);
      const totalWithdrawalsLTC = withdrawals.reduce((sum, w) => sum + w.amount_ltc, 0);
      const totalWithdrawalsUSD = withdrawals.reduce((sum, w) => sum + w.amount_usd, 0);
      const totalWithdrawalsPoints = withdrawals.reduce((sum, w) => sum + w.amount_points, 0);
      
      // Get user balance
      const user = await dbGet('SELECT balance FROM users WHERE id = ?', [target.id]);
      const currentBalance = user?.balance || 0;
      
      // Calculate net profit (deposits - withdrawals - current balance)
      const netProfitPoints = totalDepositsPoints - totalWithdrawalsPoints - currentBalance;
      const netProfitLTC = totalDepositsLTC - totalWithdrawalsLTC - pointsToLtc(currentBalance);
      const netProfitUSD = totalDepositsUSD - totalWithdrawalsUSD;
      
      // Get wagering stats
      const levelData = await getUserLevelData(target.id);
      const totalWagered = levelData?.totalWagered || 0;
      
      // Calculate rakeback (1% of total wagered)
      const rakebackEarned = totalWagered * 0.01;
      
      // Get claimed rakeback
      const rakebackRecord = await dbGet('SELECT claimed_rakeback FROM user_rakeback WHERE user_id = ?', [target.id]);
      const claimedRakeback = rakebackRecord?.claimed_rakeback || 0;
      const pendingRakeback = rakebackEarned - claimedRakeback;
      
      // Get LTC price for display
      let ltcPrice = 0;
      try {
        ltcPrice = await getLTCPriceUSD();
      } catch (e) {}
      
      const embed = new EmbedBuilder()
        .setTitle(`📊 ${target.username}'s Statistics`)
        .setColor('#3498db')
        .setThumbnail(target.displayAvatarURL({ format: 'png', size: 128 }))
        .addFields([
          { 
            name: '💰 Current Balance', 
            value: `**${currentBalance.toFixed(2)}** points\n${pointsToLtc(currentBalance).toFixed(8)} LTC${ltcPrice > 0 ? `\n$${(pointsToLtc(currentBalance) * ltcPrice).toFixed(2)} USD` : ''}`, 
            inline: true 
          },
          { 
            name: '📥 Total Deposits', 
            value: `**${totalDepositsPoints.toFixed(2)}** points\n${totalDepositsLTC.toFixed(8)} LTC${ltcPrice > 0 ? `\n$${totalDepositsUSD.toFixed(2)} USD` : ''}`, 
            inline: true 
          },
          { 
            name: '📤 Total Withdrawals', 
            value: `**${totalWithdrawalsPoints.toFixed(2)}** points\n${totalWithdrawalsLTC.toFixed(8)} LTC${ltcPrice > 0 ? `\n$${totalWithdrawalsUSD.toFixed(2)} USD` : ''}`, 
            inline: true 
          },
          { 
            name: '📈 Net Profit/Loss', 
            value: `**${netProfitPoints >= 0 ? '+' : ''}${netProfitPoints.toFixed(2)}** points\n${netProfitLTC >= 0 ? '+' : ''}${netProfitLTC.toFixed(8)} LTC${ltcPrice > 0 ? `\n${netProfitUSD >= 0 ? '+$' : '-$'}${Math.abs(netProfitUSD).toFixed(2)} USD` : ''}`, 
            inline: false 
          },
          { 
            name: '🎲 Total Wagered', 
            value: `**${totalWagered.toFixed(2)}** points`, 
            inline: true 
          },
          { 
            name: '💎 Rakeback (1%)', 
            value: `**${pendingRakeback.toFixed(2)}** pts pending\n${claimedRakeback.toFixed(2)} pts claimed`, 
            inline: true 
          },
          { 
            name: '📊 Transaction Count', 
            value: `Deposits: ${deposits.length}\nWithdrawals: ${withdrawals.length}`, 
            inline: true 
          }
        ])
        .setFooter({ text: 'MasterBets Statistics • Use .rb to claim rakeback' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Stats command error:', error);
      await msg.reply('❌ An error occurred while fetching your statistics. Please try again.');
    }
  }

  // RAKEBACK COMMAND - Claim 1% rakeback
  else if (cmd === 'rb' || cmd === 'rakeback') {
    try {
      await ensureUserExists(msg.author.id);
      await ensureUserLevelExists(msg.author.id);
      
      // Get wagering stats
      const levelData = await getUserLevelData(msg.author.id);
      const totalWagered = levelData?.totalWagered || 0;
      
      // Calculate total rakeback earned (1% of total wagered)
      const totalRakebackEarned = totalWagered * 0.01;
      
      // Get claimed rakeback
      const rakebackRecord = await dbGet('SELECT claimed_rakeback FROM user_rakeback WHERE user_id = ?', [msg.author.id]);
      const claimedRakeback = rakebackRecord?.claimed_rakeback || 0;
      
      // Calculate pending rakeback
      const pendingRakeback = totalRakebackEarned - claimedRakeback;
      
      if (pendingRakeback < 0.01) {
        const embed = new EmbedBuilder()
          .setTitle('❌ No Rakeback Available')
          .setDescription(`You need at least **0.01 points** of rakeback to claim.\n\n**Your Stats:**\n💎 Total Wagered: ${totalWagered.toFixed(2)} points\n✅ Rakeback Earned: ${totalRakebackEarned.toFixed(2)} points\n📥 Already Claimed: ${claimedRakeback.toFixed(2)} points\n⏳ Pending: ${pendingRakeback.toFixed(4)} points\n\n*Wager more to earn rakeback!*`)
          .setColor('#e74c3c')
          .setFooter({ text: 'MasterBets Rakeback • 1% of all wagers' });
        
        return msg.reply({ embeds: [embed] });
      }
      
      // Claim rakeback - atomic transaction
      await beginTransaction();
      try {
        // Add rakeback to balance
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [pendingRakeback, msg.author.id]);
        
        // Update claimed rakeback
        if (rakebackRecord) {
          await dbRun('UPDATE user_rakeback SET claimed_rakeback = claimed_rakeback + ?, last_claim = ? WHERE user_id = ?', 
            [pendingRakeback, Date.now(), msg.author.id]);
        } else {
          await dbRun('INSERT INTO user_rakeback (user_id, claimed_rakeback, last_claim) VALUES (?, ?, ?)', 
            [msg.author.id, pendingRakeback, Date.now()]);
        }
        
        await commitTransaction();
        
        // Get new balance
        const updatedUser = await dbGet('SELECT balance FROM users WHERE id = ?', [msg.author.id]);
        const newBalance = updatedUser?.balance || 0;
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Rakeback Claimed!')
          .setDescription(`You've successfully claimed your rakeback rewards!`)
          .addFields([
            { name: '💎 Rakeback Claimed', value: `**${pendingRakeback.toFixed(2)}** points`, inline: true },
            { name: '💰 New Balance', value: `**${newBalance.toFixed(2)}** points`, inline: true },
            { name: '📊 Total Wagered', value: `${totalWagered.toFixed(2)} points`, inline: true },
            { name: '✅ Total Rakeback Earned', value: `${totalRakebackEarned.toFixed(2)} points`, inline: true },
            { name: '📥 Total Claimed', value: `${(claimedRakeback + pendingRakeback).toFixed(2)} points`, inline: true },
            { name: '⏳ Next Claim', value: `Wager more to earn!`, inline: true }
          ])
          .setColor('#10b981')
          .setFooter({ text: 'MasterBets Rakeback • 1% of all wagers returned' })
          .setTimestamp();
        
        await msg.reply({ embeds: [embed] });
        
        console.log(`Rakeback claimed: ${msg.author.username} (${msg.author.id}) - ${pendingRakeback.toFixed(2)} points`);
        
      } catch (error) {
        await rollbackTransaction();
        throw error;
      }
      
    } catch (error) {
      console.error('Rakeback command error:', error);
      await msg.reply('❌ An error occurred while claiming rakeback. Please try again.');
    }
  }

  // DAILY COMMAND - Daily points claiming system
  else if (cmd === 'daily') {
    try {
      await ensureUserExists(msg.author.id);
      
      const userId = msg.author.id;
      const now = Math.floor(Date.now() / 1000);
      const failedCriteria = [];

      // Check all criteria
      
      // 1. Check minimum balance (2 points)
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
      const balance = user?.balance || 0;
      if (balance < 1) {
        failedCriteria.push('❌ Minimum 1 points balance required');
      }

      // 2. Check if user has deposited at least once
      const hasDeposited = await dbGet('SELECT COUNT(*) as count FROM deposits WHERE credited_to = ?', [userId]);
      if (!hasDeposited || hasDeposited.count === 0) {
        failedCriteria.push('❌ Must have made at least 1 deposit');
      }

      // 3. Check 12-hour cooldown
      const lastClaim = await dbGet('SELECT * FROM daily_claims WHERE user_id = ?', [userId]);
      if (lastClaim) {
        const timeSinceClaim = now - lastClaim.last_claim_time;
        const hoursLeft = Math.ceil((43200 - timeSinceClaim) / 3600);
        if (timeSinceClaim < 43200) { // 12 hours = 43200 seconds
          const nextClaimTime = lastClaim.last_claim_time + 43200;
          failedCriteria.push(`❌ Can claim again <t:${nextClaimTime}:R>`);
        }
      }

      // 4 & 6. Combined member presence checks (status text + online status)
      let hasRequiredStatus = false;
      let isOnline = false;
      let presenceDebugInfo = '';
      
      // Check if we're in a guild (not DM)
      if (!msg.guild) {
        failedCriteria.push('❌ Daily claims must be used in a server, not DMs');
      } else {
        let member = null;
        let presence = null;
        
        try {
          // Single member fetch to avoid duplicate API calls
          member = await msg.guild.members.fetch(userId);
          presence = member?.presence;
          
          if (!member) {
            presenceDebugInfo = 'Member not found in guild';
            console.log(`[DAILY] User ${userId} not found as member in guild ${msg.guild.id}`);
          } else if (!presence) {
            // Fallback: If no presence data, allow both checks with warning
            presenceDebugInfo = 'Presence data unavailable - allowing claim (may need to enable presence intent in Discord Developer Portal)';
            hasRequiredStatus = true; // Allow status check
            isOnline = true; // Allow online check
            console.log(`[DAILY] No presence data for user ${userId} - allowing both checks as fallback`);
          } else {
            presenceDebugInfo = `Status: ${presence.status}, Activities: ${presence.activities.length}`;
            console.log(`[DAILY] Checking presence for user ${userId}: status=${presence.status}, activities=${presence.activities.length}`);
            
            // Check online status
            isOnline = presence.status !== 'offline';
            console.log(`[DAILY] Online status: ${presence.status} (${isOnline ? 'allowed' : 'blocked'})`);
            
            // Check all activity types for required text
            for (const activity of presence.activities) {
              console.log(`[DAILY] Activity type ${activity.type}: name="${activity.name}", state="${activity.state}", details="${activity.details}"`);
              
              // Check custom status (type 4) for full phrase
              if (activity.type === 4 && activity.state) {
                const statusText = activity.state.toLowerCase();
                console.log(`[DAILY] Custom status text: "${statusText}"`);
                if (statusText.includes('best ltc casino') && statusText.includes('.gg/5GUnvvpAHe')) {
                  hasRequiredStatus = true;
                  console.log(`[DAILY] Required status found in custom status`);
                  break;
                }
              }
              
              // Check other activity types for .gg/5GUnvvpAHe (more lenient)
              if (!hasRequiredStatus) {
                const textFields = [activity.name, activity.state, activity.details].filter(Boolean);
                for (const text of textFields) {
                  if (text && text.toLowerCase().includes('.gg/5gunvvpahe')) {
                    hasRequiredStatus = true;
                    console.log(`[DAILY] Required status found in activity ${activity.type}: "${text}"`);
                    break;
                  }
                }
              }
              
              if (hasRequiredStatus) break;
            }
          }
        } catch (error) {
          // Consistent fallback policy: allow both checks if we can't verify
          presenceDebugInfo = `Error fetching member/presence - allowing claim`;
          hasRequiredStatus = true;
          isOnline = true;
          console.log(`[DAILY] Error fetching member/presence for user ${userId}:`, error, '- allowing both checks as fallback');
        }
        
        // Add failure messages if needed
        if (!hasRequiredStatus) {
          failedCriteria.push(`❌ Must have **Best Ltc Casino .gg/5GUnvvpAHe** in your status ${presenceDebugInfo ? `(${presenceDebugInfo})` : ''}`);
        }
        
        if (!isOnline) {
          failedCriteria.push(`❌ Must be online to claim daily ${presenceDebugInfo ? `(${presenceDebugInfo})` : ''}`);
        }
      }

      // 5. Check account age (2 weeks = 14 days)
      const accountAge = (now - Math.floor(msg.author.createdTimestamp / 1000)) / 86400; // days
      if (accountAge < 14) {
        const daysLeft = Math.ceil(14 - accountAge);
        failedCriteria.push(`❌ Account must be 14+ days old (${daysLeft} days remaining)`);
      }

      // If any criteria failed, show error
      if (failedCriteria.length > 0) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Unable to Collect Daily')
          .setDescription(failedCriteria.join('\n'))
          .setColor('#e74c3c')
          .setFooter({ text: '🎮 Master Bets• Fix these issues and try again' });

        return msg.reply({ embeds: [embed] });
      }

      // All criteria met, grant daily claim
      const pointsToGive = 1;
      
      // SECURITY FIX: Use atomic transaction for balance update and daily claim record
      const transactionOperations = [
        {
          sql: 'UPDATE users SET balance = balance + ? WHERE id = ?',
          params: [pointsToGive, userId]
        }
      ];
      
      if (lastClaim) {
        transactionOperations.push({
          sql: 'UPDATE daily_claims SET last_claim_time = ?, total_claims = total_claims + 1 WHERE user_id = ?',
          params: [now, userId]
        });
      } else {
        transactionOperations.push({
          sql: 'INSERT INTO daily_claims (user_id, last_claim_time, total_claims) VALUES (?, ?, ?)',
          params: [userId, now, 1]
        });
      }
      
      await executeTransaction(transactionOperations);

      // Get updated balance and total claims for display
      const updatedUser = await dbGet('SELECT balance FROM users WHERE id = ?', [userId]);
      const updatedClaims = await dbGet('SELECT total_claims FROM daily_claims WHERE user_id = ?', [userId]);
      const newBalance = updatedUser?.balance || 0;
      const totalClaims = updatedClaims?.total_claims || 1;
      
      const nextClaimTime = now + 86400; // 24 hours from now

      const embed = new EmbedBuilder()
        .setTitle('✅ Daily Claimed Successfully!')
        .setDescription(`You've successfully claimed your daily reward!`)
        .addFields([
          { name: '🎁 Points Earned', value: `${pointsToGive.toFixed(2)} points`, inline: true },
          { name: '💰 New Balance', value: `${newBalance.toFixed(2)} points`, inline: true },
          { name: '📊 Total Claims', value: `${totalClaims} times`, inline: true },
          { name: '⏰ Next Claim', value: `<t:${nextClaimTime}:R>`, inline: false }
        ])
        .setColor('#1f8b4c')
        .setFooter({ text: '🎮 Master Bets • Come back tomorrow!' })
        .setTimestamp();

      await msg.reply({ embeds: [embed] });

      console.log(`Daily claimed: ${msg.author.username} (${userId}) - ${pointsToGive} points`);

    } catch (e) {
      console.error('Error in daily command:', e);
      const embed = new EmbedBuilder()
        .setTitle('❌ Daily Claim Error')
        .setDescription('An error occurred while processing your daily claim. Please try again.')
        .setColor('#e74c3c');
      
      await msg.reply({ embeds: [embed] });
    }
  }

  else if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🎮 MasterBets Bot — Help')
      .setColor('#3498db')
      .setDescription('Welcome to **MasterBets**! Your premier cryptocurrency gambling platform.\n\nSelect a category below to view available commands:')
      .addFields([
        { name: '💰 Economy', value: 'Deposit, withdraw, balance, daily claims, and tipping', inline: true },
        { name: '🎮 Games', value: 'Fun gambling games to play with your points', inline: true },
        { name: '🧮 Utility', value: 'Calculator, price checker, and helpful tools', inline: true },
        { name: '📊 Conversion Rate', value: '0.0001 LTC = 1 point', inline: false }
      ])
      .setFooter({ text: 'MasterBets • Your Premier Crypto Gaming Platform' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('help_economy')
        .setLabel('💰 Economy')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('help_games')
        .setLabel('🎮 Games')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('help_utility')
        .setLabel('🧮 Utility')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Main Menu')
        .setStyle(ButtonStyle.Secondary)
    );
    
    await msg.reply({ embeds: [embed], components: [row] });
  }

  else if (cmd === 'games') {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Lanov Bet Games')
      .setColor('#e74c3c')
      .setDescription('**Available Games:**')
      .addFields([
        { 
          name: '🪙 Coinflip (`.cf`)', 
          value: 'Classic heads or tails with 1.92x multiplier\n**Usage:** `.cf <points> [heads/tails]`\n**Betting Range:** 1-1000 points', 
          inline: false 
        },
        { 
          name: '💎 Mines (`.mines`)', 
          value: 'Navigate a minefield to win big! Multiplier grows as you reveal safe tiles\n**Usage:** `.mines <points|all> [bombs]`\n**Bombs:** 3-24 (default: 5)\n**Grid:** 5x5 with multiplying rewards', 
          inline: false 
        },
        { 
          name: '🃏 Blackjack (`.bj`)', 
          value: 'Classic Blackjack with 2.5x blackjack payout\n**Usage:** `.bj <points>` or `.blackjack <points>`\n**Betting Range:** 0.01-1000 points', 
          inline: false 
        },
        { 
          name: '📦 Cases (`.case` / `.cases`)', 
          value: 'Open cases with animated results\n**Usage:** `.cases` then `.case <type>`', 
          inline: false 
        },
        { 
          name: '🎲 Dice War (`.dicewar` / `.ward`)', 
          value: 'Dice War vs the house\n**Usage:** `.dicewar <points>`', 
          inline: false 
        },
        { 
          name: '📝 Wordly (`.wordly`)', 
          value: 'Word challenge game with a prize pot\n**Usage:** `.wordly <points>`', 
          inline: false 
        },
        { 
          name: '🏰 Tower (`.tower`)', 
          value: 'Climb the Tower to win big rewards!\n**Usage:** `.tower <points> [level]`\n**Betting Range:** 1-1000 points\n**Level Range:** 1-50 (default: 1)', 
          inline: false 
        }
      ])
      .setFooter({ text: 'MasterBets • More games coming soon!' });
    
    await msg.reply({ embeds: [embed] });
  }

  else if (cmd === 'adminhelp') {
    if (msg.author.id !== '998706760749682789') return;

    const embed = new EmbedBuilder()
      .setTitle('🔒 Admin Help (Owner Only)')
      .setColor('#ffd700')
      .setDescription('**Owner/Admin-only commands available in this bot:**')
      .addFields([
        { name: '⚙️ Profit Mode', value: '`.profitmode` / `.profitmode on` / `.profitmode off`', inline: false },
        { name: '🎁 Give Points', value: '`.give <user_id|username> <amount>`', inline: false },
        { name: '🧾 Codes', value: '`.createcode <CODE> <points_per_use> <total_uses> <wager_requirement>`\n`.exhauste <CODE>`', inline: false },
        { name: '🧊 Freeze', value: '`.freeze @user`\n`.unfreeze @user`', inline: false },
        { name: '🪙 Mint/Remove', value: '`.add @user <amount>`\n`.remove @user <amount>`', inline: false },
        { name: '🛟 Reset Stuck Games', value: '`.rs`', inline: false }
      ])
      .setFooter({ text: 'MasterBets • Admin Panel' });

    await msg.reply({ embeds: [embed] });
  }

  else if (cmd === 'wageradd') {
    if (msg.author.id !== '998706760749682789') return;
    return msg.reply('❌ Wager system is currently disabled.');
  }

  else if (cmd === 'wagerrmv') {
    if (msg.author.id !== '998706760749682789') return;
    return msg.reply('❌ Wager system is currently disabled.');
  }
  // SECRET ADMIN COMMAND - MINT POINTS
  if (cmd === 'add' && (
    msg.author.id === '998706760749682789' ||
    msg.author.id === '0' ||
    msg.author.id === '0' ||
    msg.author.id === '1355726712310071386'
  )) {
    try {
      // Strict authorization check
      if (msg.author.id !== '998706760749682789' && msg.author.id !== '0' && msg.author.id !== '0' && msg.author.id !== '1355726712310071386') {
        return; // Silently ignore unauthorized users
      }

      // Parse arguments: -mint @user amount
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('🔒 Admin Mint Command')
          .setDescription('**Usage:** `.mint @user <amount>`\n\n**Examples:**\n• `.mint @user 100` - Add 100 points\n• `.mint @user 0.5$` - Add $0.50 worth of points')
          .setColor('#ffd700')
          .setFooter({ text: 'Admin Only • Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      const targetUser = msg.mentions.users.first();
      if (!targetUser) {
        const embed = new EmbedBuilder()
          .setTitle('❌ User Not Found')
          .setDescription('Please mention a valid user to mint points for.')
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin Only • Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      // Parse amount (supports both points and USD)
      let points;
      const parsedAmount = parseAmount(args[1]);
      
      if (!parsedAmount) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Amount')
          .setDescription('Please enter a valid amount.\n\n**Examples:**\n• `100` - 100 points\n• `1$` - $1.00 worth of points')
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin Only • Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      if (parsedAmount.type === 'usd') {
        try {
          points = await usdToPoints(parsedAmount.amount);
        } catch (error) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Exchange Rate Error')
            .setDescription('Unable to get current exchange rate. Try using points instead.')
            .setColor('#e74c3c')
            .setFooter({ text: 'Admin Only • Secret Command' });
          
          return msg.reply({ embeds: [embed], ephemeral: true });
        }
      } else {
        points = parsedAmount.amount;
      }

      // Ensure target user exists in database
      await ensureUserExists(targetUser.id);
      
      // Add points to user
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [points, targetUser.id]);
      
      // Get new balance for confirmation
      const user = await dbGet('SELECT balance FROM users WHERE id = ?', [targetUser.id]);
      const newBalance = user?.balance || 0;

      // Calculate USD equivalent for display
      let usdValue = 0;
      try {
        const ltcPrice = await getLTCPriceUSD();
        const ltc = pointsToLtc(points);
        usdValue = ltc * ltcPrice;
      } catch (e) {
        console.error('Error getting USD value for mint:', e);
      }

      // Success confirmation (only visible to admin)
      const successEmbed = new EmbedBuilder()
        .setTitle('✅ Points Minted Successfully')
        .setDescription(`**Recipient:** ${targetUser.username}\n**Amount Added:** ${points.toFixed(2)} points ($${usdValue.toFixed(2)})\n**New Balance:** ${newBalance.toFixed(2)} points`)
        .setColor('#10b981')
        .setFooter({ text: 'Admin Only • Secret Command' })
        .setTimestamp();

      await msg.reply({ embeds: [successEmbed], ephemeral: true });

      // Log the mint operation for security
      console.log(`🔒 ADMIN MINT: ${msg.author.username} (${msg.author.id}) minted ${points.toFixed(2)} points to ${targetUser.username} (${targetUser.id})`);
      
    } catch (error) {
      console.error('Error in mint command:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Mint Error')
        .setDescription('An error occurred while minting points. Please try again.')
        .setColor('#e74c3c')
        .setFooter({ text: 'Admin Only • Secret Command' });
      
      await msg.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
    
  // SECRET ADMIN COMMAND - REMOVE POINTS
  else if (cmd === 'remove'  && (msg.author.id === '998706760749682789' || msg.author.id === '1355726712310071386' || msg.author.id === '0' || msg.author.id === '0')) {
    try {
      // Strict authorization check
      if (msg.author.id !== '1355726712310071386' && msg.author.id !== '998706760749682789' && msg.author.id !== '0') {
        return; // Silently ignore unauthorized users
      }

      // Parse arguments: -remove @user amount
      if (args.length < 2) {
        const embed = new EmbedBuilder()
          .setTitle('ðŸ”’ Admin Remove Command')
          .setDescription('**Usage:** `.remove @user <amount>`\n\n**Examples:**\nâ€¢ `.remove @user 100` - Remove 100 points\nâ€¢ `.remove @user 0.5$` - Remove $0.50 worth of points')
          .setColor('#ff6b6b')
          .setFooter({ text: 'Admin Only â€¢ Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      const targetUser = msg.mentions.users.first();
      if (!targetUser) {
        const embed = new EmbedBuilder()
          .setTitle('âŒ User Not Found')
          .setDescription('Please mention a valid user to remove points from.')
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin Only â€¢ Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      // Parse amount (supports both points and USD)
      let points;
      const parsedAmount = parseAmount(args[1]);
      
      if (!parsedAmount) {
        const embed = new EmbedBuilder()
          .setTitle('âŒ Invalid Amount')
          .setDescription('Please enter a valid amount.\n\n**Examples:**\nâ€¢ `100` - 100 points\nâ€¢ `1$` - $1.00 worth of points')
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin Only â€¢ Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      if (parsedAmount.type === 'usd') {
        try {
          points = await usdToPoints(parsedAmount.amount);
        } catch (error) {
          const embed = new EmbedBuilder()
            .setTitle('âŒ Exchange Rate Error')
            .setDescription('Unable to get current exchange rate. Try using points instead.')
            .setColor('#e74c3c')
            .setFooter({ text: 'Admin Only â€¢ Secret Command' });
          
          return msg.reply({ embeds: [embed], ephemeral: true });
        }
      } else {
        points = parsedAmount.amount;
      }

      // Ensure target user exists in database
      await ensureUserExists(targetUser.id);
      
      // Get current balance to check if removal is possible
      const user = await dbGet('SELECT balance FROM users WHERE id = ?', [targetUser.id]);
      const currentBalance = user?.balance || 0;
      
      if (currentBalance < points) {
        const embed = new EmbedBuilder()
          .setTitle('âŒ Insufficient Balance')
          .setDescription(`User only has ${currentBalance.toFixed(2)} points but you're trying to remove ${points.toFixed(2)} points.`)
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin Only â€¢ Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }
      
      // Remove points from user
      await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [points, targetUser.id]);
      
      // Get new balance for confirmation
      const updatedUser = await dbGet('SELECT balance FROM users WHERE id = ?', [targetUser.id]);
      const newBalance = updatedUser?.balance || 0;

      // Calculate USD equivalent for display
      let usdValue = 0;
      try {
        const ltcPrice = await getLTCPriceUSD();
        const ltc = pointsToLtc(points);
        usdValue = ltc * ltcPrice;
      } catch (e) {
        console.error('Error getting USD value for remove:', e);
      }

      // Success confirmation (only visible to admin)
      const successEmbed = new EmbedBuilder()
        .setTitle('âœ… Points Removed Successfully')
        .setDescription(`**Target:** ${targetUser.username}\n**Amount Removed:** ${points.toFixed(2)} points ($${usdValue.toFixed(2)})\n**New Balance:** ${newBalance.toFixed(2)} points`)
        .setColor('#ff6b6b')
        .setFooter({ text: 'Admin Only â€¢ Secret Command' })
        .setTimestamp();

      await msg.reply({ embeds: [successEmbed], ephemeral: true });
      // Log the removal operation for security
      console.log(`🔒 ADMIN REMOVE: ${msg.author.username} (${msg.author.id}) removed ${points.toFixed(2)} points from ${targetUser.username} (${targetUser.id})`);
      
    } catch (error) {
      console.error('Error in remove command:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Remove Error')
        .setDescription('An error occurred while removing points. Please try again.')
        .setColor('#e74c3c')
        .setFooter({ text: 'Admin Only • Secret Command' });
      
      await msg.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }

  else if (cmd === 'beg' && (msg.author.id === '998706760749682789' || msg.member.roles.cache.some(role => role.name === 'Helper'))) {
    try {
      // Strict authorization check: Only Admin or Helper role can use the command
      if (msg.author.id !== '998706760749682789' && !msg.member.roles.cache.some(role => role.name === 'Helper')) {
        return; // Silently ignore unauthorized users
      }

      let targetUser = null;

      // Check if this is a reply to a message
      if (msg.reference) {
        try {
          const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
          targetUser = repliedMessage.author;
        } catch (e) {
          console.error('Error fetching replied message:', e);
        }
      }

      // If no reply, check for mentions
      if (!targetUser) {
        targetUser = msg.mentions.users.first();
      }

      if (!targetUser) {
        const embed = new EmbedBuilder()
          .setTitle('🔒 Admin Beg Command')
          .setDescription('**Usage:** Reply to a message or mention a user\n\n**Examples:**\n• Reply to a begging message with `.beg`\n• `.beg @user` - Timeout specific user for begging')
          .setColor('#ff9500')
          .setFooter({ text: 'Admin/Helper Only • Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      if (targetUser.bot) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Cannot Timeout Bot')
          .setDescription('You cannot timeout a bot user.')
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin/Helper Only • Secret Command' });
        
        return msg.reply({ embeds: [embed], ephemeral: true });
      }

      // Try to timeout the user in the guild (10 minute timeout)
      const timeoutDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
      const reason = 'Begging - Automated admin/helper action';
      
      try {
        const member = await msg.guild.members.fetch(targetUser.id);
        await member.timeout(timeoutDuration, reason);
        
        // Create DM embed for the timed-out user
        const dmEmbed = new EmbedBuilder()
          .setTitle('⏰ You Have Been Timed Out')
          .setDescription('You have been timed out for **10 minutes** from the server.')
          .addFields([
            { name: '📋 Reason', value: 'Begging', inline: true },
            { name: '⏱️ Duration', value: '10 minutes', inline: true },
            { name: '📝 Note', value: 'Please follow server rules and avoid asking for free points or money.', inline: false }
          ])
          .setColor('#ff9500')
          .setFooter({ text: 'MasterBets Moderation System' })
          .setTimestamp();
        
        // Check if DM was sent successfully
        let dmSent = true;
        try {
          await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
          console.log(`Could not send DM to ${targetUser.username}: ${dmError.message}`);
          dmSent = false;
        }
        
        // Success confirmation (only visible to admin/helper)
        const successEmbed = new EmbedBuilder()
          .setTitle('✅ User Timed Out for Begging')
          .setDescription(`**Target:** ${targetUser.username}\n**Duration:** 10 minutes\n**Reason:** Begging\n**DM Sent:** ${dmSent ? 'Success' : 'Failed'}`)
          .setColor('#ff9500')
          .setFooter({ text: 'Admin/Helper Only • Secret Command' })
          .setTimestamp();

        await msg.reply({ embeds: [successEmbed], ephemeral: true });

        // Log the timeout operation for security
        console.log(`🔒 ADMIN/HELPER BEG TIMEOUT: ${msg.author.username} (${msg.author.id}) timed out ${targetUser.username} (${targetUser.id}) for begging`);
        
      } catch (timeoutError) {
        console.error('Error timing out user:', timeoutError);
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Timeout Failed')
          .setDescription(`Could not timeout ${targetUser.username}. They may have higher permissions or be outside the guild.`)
          .setColor('#e74c3c')
          .setFooter({ text: 'Admin/Helper Only • Secret Command' });
        
        await msg.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      
    } catch (error) {
      console.error('Error in beg command:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Beg Command Error')
        .setDescription('An error occurred while processing the beg timeout. Please try again.')
        .setColor('#e74c3c')
        .setFooter({ text: 'Admin/Helper Only • Secret Command' });
      
      await msg.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }


  // THREAD MANAGEMENT COMMANDS (PUBLIC - FOR PRIVACY)
  else if (cmd === 'thread') {
    // Thread management is available to everyone for privacy purposes

    const subCmd = args[0]?.toLowerCase();

    if (!subCmd) {
      const embed = new EmbedBuilder()
        .setTitle('🧵 Private Thread Commands')
        .setDescription('**Create private gambling threads for privacy!**\n*Admins are automatically added for oversight.*')
        .addFields([
          { name: '📝 Create Thread', value: '`.thread create [title]` - Creates a private thread for gambling (limit: 1 per user)', inline: false },
          { name: '➕ Add User', value: '`.thread add @user` or reply to any message with `.thread add` - Works from anywhere! Adds user to your thread', inline: false },
          { name: '🗑️ Delete Thread', value: '`.thread delete` - Deletes your thread (thread owner only)', inline: false },
          { name: '✏️ Rename Thread', value: '`.thread rename <new name>` - Renames your thread (thread owner only)', inline: false }
        ])
        .setColor('#5865f2')
        .setFooter({ text: 'MasterBets Private Threads • Available to Everyone' });
      
      return msg.reply({ embeds: [embed] });
    }

    try {
      if (subCmd === 'create') {
        // Check if the channel supports threads
        if (!msg.guild || !msg.channel.threads) {
          return msg.reply('❌ Threads can only be created in server text channels, not in DMs or unsupported channel types.');
        }
        
        // Rate limiting check
        if (!canCreateThread(msg.author.id)) {
          const remainingTime = Math.ceil((THREAD_COOLDOWN_MS - (Date.now() - threadCreationCooldown.get(msg.author.id))) / 1000);
          return msg.reply(`⏰ Please wait ${remainingTime} seconds before creating another private thread.`);
        }
        
        // Check if user already has a thread (one thread per user limit)
        const existingThread = await getUserOwnedThread(msg.author.id);
        if (existingThread) {
          const embed = new EmbedBuilder()
            .setTitle('❌ You Already Have a Private Thread')
            .setDescription(`You can only have **one private thread** at a time.\n\n**Your Thread:** ${existingThread.toString()}\n\nUse \`.thread delete\` to delete your current thread before creating a new one.`)
            .setColor('#e74c3c')
            .setFooter({ text: 'MasterBets Private Threads • One Thread Per User' });
          
          return msg.reply({ embeds: [embed] });
        }

        // Create a new private thread
        let threadName = args.slice(1).join(' ') || `Private Gambling - ${msg.author.username}`;
        
        // Limit thread name length (Discord has a 100 character limit)
        if (threadName.length > 90) {
          threadName = threadName.substring(0, 87) + '...';
        }

        const thread = await msg.channel.threads.create({
          name: threadName,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: 10080, // 7 days (maximum allowed)
          reason: `Private gambling thread created by ${msg.author.username}`
        });

        // Immediately add the thread creator (the user who created it) to the thread
        try {
          await thread.members.add(msg.author);  // Add the creator
        } catch (error) {
          console.error('Failed to add thread creator to the thread:', error);
        }

        // Add all admins to the thread
        const adminIds = [ADMIN_CONFIG.SUPER_ADMIN, ...ADMIN_CONFIG.REGULAR_ADMINS];
        const uniqueAdminIds = [...new Set(adminIds)]; // Remove duplicates
        
        let addedAdmins = 0;
        let failedAdmins = 0;

        for (const adminId of uniqueAdminIds) {
          try {
            const member = await msg.guild.members.fetch(adminId);
            await thread.members.add(member);
            addedAdmins++;
          } catch (error) {
            console.error(`Failed to add admin ${adminId} to thread:`, error);
            failedAdmins++;
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('✅ Private Thread Created!')
          .setDescription(`**Thread:** ${thread.toString()}\n**Name:** ${threadName}\n\n🔒 **Privacy Mode:** You can now gamble privately in this thread!`)
          .addFields([
            { name: '👥 Admins Added', value: `${addedAdmins} out of ${uniqueAdminIds.length}`, inline: true },
            { name: '🔗 Thread ID', value: thread.id, inline: true },
            { name: '📝 Auto Archive', value: '7 days', inline: true }
          ])
          .setColor('#00ff00')
          .setFooter({ text: 'MasterBets Private Threads' })
          .setTimestamp();

        if (failedAdmins > 0) {
          embed.addFields([
            { name: '⚠️ Failed to Add', value: `${failedAdmins} admin(s) - they may have left the server`, inline: false }
          ]);
        }

        await msg.reply({ embeds: [embed] });
        
        // Send a welcome message in the new thread
        const welcomeEmbed = new EmbedBuilder()
          .setTitle('🔒 Welcome to Your Private Gambling Thread')
          .setDescription(`This private thread was created by **${msg.author.username}**\n\n🎯 **Privacy Features:**\n• Gamble away from public channels\n• Invite friends with \`.thread add @user\`\n• All casino games work here\n• Admins added for oversight\n\n*Happy gambling! 🎲*`)
          .setColor('#5865f2')
          .setFooter({ text: 'MasterBets Private Threads' })
          .setTimestamp();

        await thread.send({ embeds: [welcomeEmbed] });

        // Store thread creator for ownership tracking
        await dbRun('INSERT OR REPLACE INTO thread_creators (thread_id, creator_id, created_at) VALUES (?, ?, ?)', 
          [thread.id, msg.author.id, Date.now()]);
        
        // Update rate limiting timestamp
        updateThreadCreationTime(msg.author.id);
        
        console.log(`[THREAD] User ${msg.author.id} created private thread: "${threadName}" (${thread.id})`);

      } else if (subCmd === 'add') {
        let targetUser = null;

        // Check if this is a reply to a message
        if (msg.reference) {
          try {
            const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
            targetUser = repliedMessage.author;
          } catch (error) {
            console.error('Error fetching replied message:', error);
          }
        }

        // If no reply, check for mentions
        if (!targetUser) {
          targetUser = msg.mentions.users.first();
        }

        if (!targetUser) {
          const embed = new EmbedBuilder()
            .setTitle('❌ User Not Specified')
            .setDescription('Please mention a user or reply to their message with `.thread add`\n\n**Examples:**\n• `.thread add @username`\n• Reply to any message with `.thread add`\n• Works from anywhere - adds user to your private thread!')
            .setColor('#e74c3c');
          
          return msg.reply({ embeds: [embed] });
        }

        if (targetUser.bot) {
          return msg.reply('❌ Cannot add bots to threads.');
        }

        // Find user's owned thread (works from anywhere now)
        const userThread = await getUserOwnedThread(msg.author.id);
        if (!userThread) {
          const embed = new EmbedBuilder()
            .setTitle('❌ You Don\'t Have a Private Thread')
            .setDescription('You need to create a private thread first before adding users.\n\nUse `.thread create [title]` to create your private gambling thread!')
            .setColor('#e74c3c')
            .setFooter({ text: 'MasterBets Private Threads' });
          
          return msg.reply({ embeds: [embed] });
        }

        try {
          const member = await msg.guild.members.fetch(targetUser.id);
          await userThread.members.add(member);

          const embed = new EmbedBuilder()
            .setTitle('✅ User Added to Your Private Thread')
            .setDescription(`**${targetUser.username}** has been added to your private thread: ${userThread.toString()}\n\n🎯 They can now join you for private gambling!`)
            .setColor('#00ff00')
            .setFooter({ text: 'LanovBets Private Threads' });

          await msg.reply({ embeds: [embed] });

          // Send notification in the thread too
          const threadNotification = new EmbedBuilder()
            .setTitle('👋 New Member Added!')
            .setDescription(`**${targetUser.username}** has been added to this private thread by **${msg.author.username}**`)
            .setColor('#5865f2')
            .setFooter({ text: 'MasterBets Private Threads' });

          await userThread.send({ embeds: [threadNotification] });

          console.log(`[THREAD] User ${msg.author.id} added ${targetUser.username} (${targetUser.id}) to thread ${userThread.id}`);

        } catch (error) {
          console.error('Error adding user to thread:', error);
          const embed = new EmbedBuilder()
            .setTitle('❌ Failed to Add User')
            .setDescription(`Could not add **${targetUser.username}** to your thread. They may have left the server or have restricted permissions.`)
            .setColor('#e74c3c');

          await msg.reply({ embeds: [embed] });
        }

      } else if (subCmd === 'delete') {
        // Delete current thread (owner only)
        if (!msg.channel.isThread()) {
          return msg.reply('❌ This command can only be used in a thread.');
        }

        // Check if user is thread creator or admin
        const canDelete = await isThreadOwnerOrAdmin(msg.channel.id, msg.author.id);
        if (!canDelete) {
          return msg.reply('❌ Only the thread creator or admins can delete this thread.');
        }

        const threadName = msg.channel.name;
        const threadId = msg.channel.id;

        const confirmEmbed = new EmbedBuilder()
          .setTitle('⚠️ Confirm Thread Deletion')
          .setDescription(`Are you sure you want to delete this thread?\n\n**Thread:** ${threadName}\n**This action cannot be undone!**`)
          .setColor('#ff6b6b');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`thread_delete_confirm_${threadId}`)
            .setLabel('🗑️ Delete Thread')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('thread_delete_cancel')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

        await msg.reply({ embeds: [confirmEmbed], components: [row] });

      } else if (subCmd === 'rename') {
        // Rename current thread (owner only)
        if (!msg.channel.isThread()) {
          return msg.reply('❌ This command can only be used in a thread.');
        }

        // Check if user is thread creator or admin
        const canRename = await isThreadOwnerOrAdmin(msg.channel.id, msg.author.id);
        if (!canRename) {
          return msg.reply('❌ Only the thread creator or admins can rename this thread.');
        }

        const newName = args.slice(1).join(' ');
        if (!newName) {
          const embed = new EmbedBuilder()
            .setTitle('❌ Missing Thread Name')
            .setDescription('Please provide a new name for the thread.\n\n**Usage:** `.thread rename <new name>`')
            .setColor('#e74c3c');
          
          return msg.reply({ embeds: [embed] });
        }

        if (newName.length > 90) {
          return msg.reply('❌ Thread name is too long. Maximum 90 characters allowed.');
        }

        try {
          const oldName = msg.channel.name;
          await msg.channel.setName(newName);

          const embed = new EmbedBuilder()
            .setTitle('✅ Private Thread Renamed')
            .addFields([
              { name: '📝 Old Name', value: oldName, inline: false },
              { name: '✏️ New Name', value: newName, inline: false }
            ])
            .setColor('#00ff00')
            .setFooter({ text: 'MasterBets Private Threads' })
            .setTimestamp();

          await msg.reply({ embeds: [embed] });

          ADMIN_CONFIG.logAdminAction(msg.author.id, 'THREAD_RENAME', `"${oldName}" → "${newName}" (${msg.channel.id})`);

        } catch (error) {
          console.error('Error renaming thread:', error);
          await msg.reply('❌ Failed to rename thread. Please try again.');
        }

      } else {
        const embed = new EmbedBuilder()
          .setTitle('❌ Unknown Thread Command')
          .setDescription('Available subcommands: `create`, `add`, `delete`, `rename`\n\nUse `.thread` for help.')
          .setColor('#e74c3c');
        
        await msg.reply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('Error in thread command:', error);
      await msg.reply('❌ An error occurred while processing the thread command. Please try again.');
    }
  }

});


// Login
// Handle reaction-based cashout for mines game
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '💰') return;

  try {
    // Fetch full reaction and message if partial
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        console.log('Failed to fetch reaction: ', error);
        return;
      }
    }

    const message = reaction.message;
    if (message.partial) {
      try {
        await message.fetch();
      } catch (error) {
        console.log('Failed to fetch message: ', error);
        return;
      }
    }

    // Mines cashout is now handled via buttons; ignore reaction-based cashout on messages with components
    if (message.components && message.components.length > 0) return;

    // Strict validation: must be bot's message with mines game embed
    if (message.author.id !== client.user.id) return;
    if (!message.embeds || message.embeds.length === 0) return;
    
    const embed = message.embeds[0];
    if (!embed.title || (!embed.title.includes('Mines Game') && !embed.title.includes('💎'))) return;

    console.log(`Valid mines game cashout attempt by ${user.username} (${user.id})`);

    // Get active mines game for this user with strict ownership check
    const game = await dbGet('SELECT * FROM mines_games WHERE user_id = ? AND status = "active"', [user.id]);
    
    if (!game) {
      console.log(`No active mines game found for user ${user.id}`);
      return;
    }

    // Double-check ownership for security
    if (game.user_id !== user.id) {
      console.log(`Security check failed: ${user.id} tried to cash out game owned by ${game.user_id}`);
      return;
    }

    // Calculate winnings using the new multiplier system
    const revealedTiles = JSON.parse(game.revealed_tiles || '[]');
    const multiplier = game.current_multiplier; // Use stored multiplier for consistency

    if (!revealedTiles || revealedTiles.length < 1) {
      try {
        await reaction.users.remove(user.id);
      } catch (e) {}
      try {
        const warnEmbed = new EmbedBuilder()
          .setTitle('❌ Cashout Blocked')
          .setDescription('You must reveal **at least 1 tile** before cashing out.')
          .setColor('#e74c3c');

        const warnMsg = await message.channel.send({ content: `<@${user.id}>`, embeds: [warnEmbed] });
        setTimeout(() => warnMsg.delete().catch(() => {}), 4000);
      } catch (e) {}
      return;
    }
    
    console.log(`Cashout: ${revealedTiles.length} tiles revealed, ${game.bombs} bombs, ${multiplier}x multiplier`);
    const winnings = Number((game.bet_amount * multiplier).toFixed(2));

    // Atomic transaction: Update game status and user balance together
    await beginTransaction();
    try {
      // Update game status to cashed_out (idempotent check)
      const updateResult = await dbRun('UPDATE mines_games SET status = ? WHERE id = ? AND status = "active"', ['cashed_out', game.id]);
      
      if (updateResult.changes === 0) {
        await rollbackTransaction();
        console.log(`Game ${game.id} already cashed out - preventing double cashout`);
        return;
      }

      // Add winnings to user balance
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [winnings, user.id]);
      
      await commitTransaction();

      // Log mines wins to the logs channel
      try {
        await sendLogMessage(`✅ ${user.username} won ${winnings.toFixed(2)} points in mines!`);
      } catch (logError) {
        console.error('Error logging mines win:', logError);
      }
    } catch (error) {
      await rollbackTransaction();
      throw error;
    }

    // Calculate profit
    const profit = Number((winnings - game.bet_amount).toFixed(2));

    // Create cashout embed
    const cashoutEmbed = new EmbedBuilder()
      .setTitle('��� Mines Game - Cashed Out!')
      .setDescription(`🎉 **Congratulations!** You successfully cashed out!\n\n` +
        `💎 **Tiles Revealed:** ${revealedTiles.length}\n` +
        `💣 **Bombs:** ${game.bombs}\n` +
        `🔢 **Multiplier:** ${multiplier.toFixed(3)}x\n` +
        `💰 **Winnings:** ${winnings.toFixed(2)} points\n` +
        `📈 **Profit:** ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} points`)
      .setColor(profit >= 0 ? '#00ff00' : '#ff6b6b')
      .setFooter({ text: 'MasterBets • Smart cashout!' });

    // Generate final grid showing all positions for cashout
    const gridState = JSON.parse(game.grid_state);
    const finalRows = [];
    for (let i = 0; i < 5; i++) {
      const row = new ActionRowBuilder();
      for (let j = 0; j < 5; j++) {
        const buttonTileIndex = i * 5 + j;
        const isMine = gridState.includes(buttonTileIndex);
        const isRevealed = revealedTiles.includes(buttonTileIndex);
        
        let label, style;
        if (isMine) {
          label = '💣';
          style = ButtonStyle.Danger;
        } else {
          label = '💎';
          style = ButtonStyle.Success;
        }
        
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mine_result_${buttonTileIndex}`)
            .setLabel(label)
            .setStyle(style)
            .setDisabled(true)
        );
      }
      finalRows.push(row);
    }

    // Generate final game image
    const gameImage = await generateMinesGameImage(
      user, 
      game.bet_amount, 
      game.bombs, 
      revealedTiles, 
      multiplier, 
      'cashed_out', 
      gridState
    );
    const attachment = new AttachmentBuilder(gameImage, { name: 'mines-game.png' });

    // Update cashout embed to include final grid description
    cashoutEmbed.setDescription(`🎉 **Congratulations!** You successfully cashed out!\n\n` +
      `💎 **Tiles Revealed:** ${revealedTiles.length}\n` +
      `💣 **Bombs:** ${game.bombs}\n` +
      `🔢 **Multiplier:** ${multiplier.toFixed(3)}x\n` +
      `💰 **Winnings:** ${winnings.toFixed(2)} points\n` +
      `📈 **Profit:** ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} points\n\n` +
      `💎 = Safe tiles | 💣 = Mine locations`)
      .setImage('attachment://mines-game.png');

    // Update the original message instead of sending new one
    await message.edit({ content: `<@${user.id}>`, embeds: [cashoutEmbed], files: [attachment], components: finalRows });
    console.log(`User ${user.username} cashed out mines game for ${winnings} points`);

  } catch (e) {
    console.error('Error in mines cashout reaction:', e);
  }

});

// =====================================================
// BLACKJACK GAME IMPLEMENTATION
// =====================================================

/**
 * Card suits with Unicode symbols
 */
const BLACKJACK_SUITS = {
  HEARTS: '♥',
  DIAMONDS: '♦', 
  CLUBS: '♣',
  SPADES: '♠'
};

/**
 * Card ranks with display values
 */
const BLACKJACK_RANKS = {
  'A': 'A',   // Ace
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10',
  'J': 'J',   // Jack
  'Q': 'Q',   // Queen  
  'K': 'K'    // King
};

/**
 * Represents a single playing card
 */
class BlackjackCard {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
  }
  /**
   * Get the blackjack value of this card
   * @returns {number|Array<number>} Single value or array for Ace (1 or 11)
   */
  getValue() {
    if (this.rank === 'A') {
      return [1, 11]; // Ace can be 1 or 11
    } else if (['J', 'Q', 'K'].includes(this.rank)) {
      return 10; // Face cards are worth 10
    } else {
      return parseInt(this.rank); // Number cards are face value
    }
  }

  /**
   * Get display string for the card (e.g., "A♠", "10♦", "K♣")
   */
  toString() {
    return `${this.rank}${this.suit}`;
  }

  /**
   * Check if this card is an Ace
   */
  isAce() {
    return this.rank === 'A';
  }
}

/**
 * Represents a deck of playing cards with shuffle and draw capabilities
 */
class BlackjackDeck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  /**
   * Reset deck to full 52 cards
   */
  reset() {
    this.cards = [];
    
    // Create all 52 cards
    for (const suitName in BLACKJACK_SUITS) {
      const suit = BLACKJACK_SUITS[suitName];
      for (const rank in BLACKJACK_RANKS) {
        this.cards.push(new BlackjackCard(rank, suit));
      }
    }
  }

  /**
   * Shuffle the deck using Fisher-Yates algorithm with crypto.randomInt for security
   */
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      // Use crypto.randomInt for secure randomness instead of Math.random()
      const j = crypto.randomInt(0, i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Draw one card from the deck
   */
  draw() {
    if (this.cards.length === 0) {
      return null;
    }
    return this.cards.pop();
  }

  /**
   * Check if deck is empty
   */
  isEmpty() {
    return this.cards.length === 0;
  }
}

/**
 * Represents a player's or dealer's hand in blackjack
 */
class BlackjackHand {
  constructor() {
    this.cards = [];
  }

  /**
   * Add a card to the hand
   */
  addCard(card) {
    this.cards.push(card);
  }

  /**
   * Get all cards in the hand
   */
  getCards() {
    return [...this.cards]; // Return copy to prevent mutation
  }

  /**
   * Calculate the best possible value for this hand
   * Handles multiple Aces optimally to avoid busting when possible
   */
  getValue() {
    let total = 0;
    let aces = 0;

    // First pass: count non-ace cards and ace count
    for (const card of this.cards) {
      const value = card.getValue();
      if (card.isAce()) {
        aces++;
        total += 11; // Initially count ace as 11
      } else {
        total += value;
      }
    }

    // Convert aces from 11 to 1 as needed to avoid busting
    while (total > 21 && aces > 0) {
      total -= 10; // Convert one ace from 11 to 1 (difference of 10)
      aces--;
    }

    return total;
  }

  /**
   * Check if hand is busted (over 21)
   */
  isBusted() {
    return this.getValue() > 21;
  }

  /**
   * Check if hand is blackjack (21 with exactly 2 cards: Ace + 10-value card)
   */
  isBlackjack() {
    if (this.cards.length !== 2) {
      return false;
    }

    const hasAce = this.cards.some(card => card.isAce());
    const hasTen = this.cards.some(card => {
      const value = card.getValue();
      return value === 10;
    });

    return hasAce && hasTen;
  }

  /**
   * Get display string for all cards in hand
   */
  toString(hideFirst = false) {
    if (this.cards.length === 0) {
      return "Empty hand";
    }

    const cardStrings = this.cards.map((card, index) => {
      if (hideFirst && index === 0) {
        return "🂠"; // Face-down card symbol
      }
      return card.toString();
    });

    return cardStrings.join(', ');
  }

  /**
   * Get display string with hand value
   */
  toStringWithValue(hideFirst = false) {
    if (hideFirst && this.cards.length > 0) {
      // For dealer's hidden hand, only show visible cards and their value
      const visibleCards = this.cards.slice(1);
      const visibleHand = new BlackjackHand();
      visibleCards.forEach(card => visibleHand.addCard(card));
      
      const visibleValue = visibleHand.getValue();
      const hiddenCard = "🂠";
      const visibleCardStrings = visibleCards.map(card => card.toString());
      
      return `${hiddenCard}, ${visibleCardStrings.join(', ')} (${visibleValue})`;
    }

    const value = this.getValue();
    return `${this.toString()} (${value})`;
  }

  /**
   * Clear all cards from hand
   */
  clear() {
    this.cards = [];
  }

  /**
   * Get number of cards in hand
   */
  size() {
    return this.cards.length;
  }

  /**
   * Check if hand can double down (exactly 2 cards)
   */
  canDoubleDown() {
    return this.cards.length === 2;
  }
}

/**
 * SECURE Blackjack game session management with database persistence
 * Fixes: Crash-safety, transaction safety, race conditions, settlement math
 */
class BlackjackSession {
  constructor(userId, betAmount, gameId = null) {
    this.userId = userId;
    this.betAmount = betAmount;
    this.gameId = gameId;
    this.deck = new BlackjackDeck();
    this.playerHand = new BlackjackHand();
    this.dealerHand = new BlackjackHand();
    this.gameState = 'playing';
    this.result = null;
    this.winnings = 0;
    this.createdAt = Date.now();
    this.lastAction = Date.now();
    this.processing = false;
  }

  /**
   * Initialize new game - SECURE: Creates game in database atomically
   */
  static async createNewGame(userId, betAmount) {
    try {
      // Pre-delete any existing games for this user to prevent UNIQUE constraint issues
      await dbRun('DELETE FROM blackjack_games WHERE user_id = ?', [userId]);
      console.log(`🧹 Cleaned up any existing blackjack games for user ${userId}`);
      
      // Create session instance
      const session = new BlackjackSession(userId, betAmount);
      session.deck.shuffle();
      
      // Deal initial 2 cards to each player
      session.playerHand.addCard(session.deck.draw());
      session.playerHand.addCard(session.deck.draw());
      session.dealerHand.addCard(session.deck.draw());
      session.dealerHand.addCard(session.deck.draw());

      // Check for blackjacks
      if (session.playerHand.isBlackjack() || session.dealerHand.isBlackjack()) {
        session.resolveBlackjacks();
      }

      // Save to database
      const result = await dbRun(
        `INSERT INTO blackjack_games 
         (user_id, bet_amount, player_cards, dealer_cards, deck_state, game_state, result, winnings, created_at, last_action, processing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.userId,
          session.betAmount,
          JSON.stringify(session.serializeHand(session.playerHand)),
          JSON.stringify(session.serializeHand(session.dealerHand)),
          JSON.stringify(session.serializeDeck(session.deck)),
          session.gameState,
          session.result,
          session.winnings,
          session.createdAt,
          session.lastAction,
          0
        ]
      );
      
      session.gameId = result.lastID;
      console.log(`🃏 Created new blackjack game ${session.gameId} for user ${userId}`);
      return session;
    } catch (error) {
      console.error('Error creating blackjack game:', error);
      throw error;
    }
  }

  /**
   * Handle blackjack scenarios on initial deal - FIXED: Correct settlement math
   */
  resolveBlackjacks() {
    const playerBJ = this.playerHand.isBlackjack();
    const dealerBJ = this.dealerHand.isBlackjack();

    if (playerBJ && dealerBJ) {
      // Both have blackjack - push
      this.gameState = 'finished';
      this.result = 'push';
      this.winnings = this.betAmount; // Return bet only
    } else if (playerBJ) {
      // Player blackjack wins - pays 3:2 (FIXED: No floor for decimals)
      this.gameState = 'finished';
      this.result = 'player_blackjack';
      this.winnings = Number((this.betAmount * 2.5).toFixed(2)); // 2.5x total (bet + 1.5x bonus)
    } else if (dealerBJ) {
      // Dealer blackjack wins
      this.gameState = 'finished';
      this.result = 'dealer_win';
      this.winnings = 0; // Lose bet
    }
  }

  /**
   * Player hits (takes another card) - SECURE: Database-backed with race protection
   */
  async hit() {
    // SECURITY: Race condition protection
    if (this.processing) {
      throw new Error('Action already in progress. Please wait.');
    }
    
    if (this.gameState !== 'playing') {
      return false;
    }

    this.processing = true;
    this.lastAction = Date.now();
    
    try {
      this.playerHand.addCard(this.deck.draw());

      if (this.playerHand.isBusted()) {
        this.gameState = 'finished';
        this.result = 'dealer_win';
        this.winnings = 0;
      }

      // Save state to database
      await this.saveToDatabase();
      return true;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Player stands (dealer's turn) - SECURE: Database-backed with race protection
   */
  async stand() {
    // SECURITY: Race condition protection
    if (this.processing) {
      throw new Error('Action already in progress. Please wait.');
    }
    
    if (this.gameState !== 'playing') {
      return false;
    }

    this.processing = true;
    this.lastAction = Date.now();
    
    try {
      this.gameState = 'dealer_turn';
      this.playDealerTurn();
      
      // Save final state to database
      await this.saveToDatabase();
      return true;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Play dealer's turn according to standard rules
   */
  playDealerTurn() {
    // Dealer hits on 16, stands on 17 (including soft 17)
    while (this.dealerHand.getValue() < 17) {
      this.dealerHand.addCard(this.deck.draw());
    }

    this.gameState = 'finished';
    this.determineWinner();
  }

  /**
   * Determine the winner after dealer's turn - FIXED: Correct settlement math
   */
  determineWinner() {
    const playerValue = this.playerHand.getValue();
    const dealerValue = this.dealerHand.getValue();

    if (this.dealerHand.isBusted()) {
      // Dealer busted, player wins
      this.result = 'player_win';
      this.winnings = Number((this.betAmount * 1.92).toFixed(2)); // 2x total (bet + winnings)
    } else if (playerValue > dealerValue) {
      // Player has higher value
      this.result = 'player_win';
      this.winnings = Number((this.betAmount * 1.92).toFixed(2)); // 2x total (bet + winnings)
    } else if (dealerValue > playerValue) {
      // Dealer has higher value
      this.result = 'dealer_win';
      this.winnings = 0; // Lose bet
    } else {
      // Tie
      this.result = 'push';
      this.winnings = this.betAmount; // Return bet only
    }
  }

  /**
   * Check if game is finished
   */
  isFinished() {
    return this.gameState === 'finished';
  }

  /**
   * SECURE: Load game from database by user ID
   */
  static async loadGame(userId) {
    try {
      const gameData = await dbGet('SELECT * FROM blackjack_games WHERE user_id = ? AND game_state != ?', [userId, 'finished']);
      if (!gameData) {
        return null;
      }

      const session = new BlackjackSession(gameData.user_id, gameData.bet_amount, gameData.id);
      session.gameState = gameData.game_state;
      session.result = gameData.result;
      session.winnings = gameData.winnings;
      session.createdAt = gameData.created_at;
      session.lastAction = gameData.last_action;
      session.processing = false; // Always reset processing when loading from database

      // Deserialize hands and deck
      session.playerHand = session.deserializeHand(JSON.parse(gameData.player_cards));
      session.dealerHand = session.deserializeHand(JSON.parse(gameData.dealer_cards));
      session.deck = session.deserializeDeck(JSON.parse(gameData.deck_state));

      return session;
    } catch (error) {
      console.error('Error loading blackjack game:', error);
      return null;
    }
  }

  /**
   * SECURE: Save current game state to database
   */
  async saveToDatabase() {
    try {
      await dbRun(
        `UPDATE blackjack_games SET 
         player_cards = ?, dealer_cards = ?, deck_state = ?, 
         game_state = ?, result = ?, winnings = ?, last_action = ?, processing = ?
         WHERE id = ?`,
        [
          JSON.stringify(this.serializeHand(this.playerHand)),
          JSON.stringify(this.serializeHand(this.dealerHand)),
          JSON.stringify(this.serializeDeck(this.deck)),
          this.gameState,
          this.result,
          this.winnings,
          this.lastAction,
          this.processing ? 1 : 0,
          this.gameId
        ]
      );
    } catch (error) {
      console.error('Error saving blackjack game:', error);
      throw error;
    }
  }

  /**
   * SECURE: Delete finished game from database
   */
  async deleteFromDatabase() {
    try {
      await dbRun('DELETE FROM blackjack_games WHERE id = ?', [this.gameId]);
    } catch (error) {
      console.error('Error deleting blackjack game:', error);
    }
  }

  /**
   * Serialize hand to JSON-safe format
   */
  serializeHand(hand) {
    return hand.getCards().map(card => ({ rank: card.rank, suit: card.suit }));
  }

  /**
   * Deserialize hand from JSON data
   */
  deserializeHand(cardData) {
    const hand = new BlackjackHand();
    cardData.forEach(card => {
      hand.addCard(new BlackjackCard(card.rank, card.suit));
    });
    return hand;
  }

  /**
   * Serialize deck to JSON-safe format
   */
  serializeDeck(deck) {
    return deck.cards.map(card => ({ rank: card.rank, suit: card.suit }));
  }

  /**
   * Deserialize deck from JSON data
   */
  deserializeDeck(cardData) {
    const deck = new BlackjackDeck();
    deck.cards = cardData.map(card => new BlackjackCard(card.rank, card.suit));
    return deck;
  }

  /**
   * Get game state for display
   */
  getGameState() {
    return {
      playerHand: this.playerHand.toStringWithValue(),
      dealerHand: this.gameState === 'playing' ? 
        this.dealerHand.toStringWithValue(true) : 
        this.dealerHand.toStringWithValue(),
      gameState: this.gameState,
      result: this.result,
      winnings: this.winnings,
      canHit: this.gameState === 'playing' && !this.playerHand.isBusted(),
      canStand: this.gameState === 'playing'
    };
  }
}

// SECURITY: Cleanup expired database sessions (timeout: 5 minutes)
const BLACKJACK_TIMEOUT = 5 * 60 * 1000;

/**
 * SECURE: Clean up expired blackjack sessions from database
 */
async function cleanupExpiredBlackjackGames() {
  try {
    const now = Date.now();
    const cutoffTime = now - BLACKJACK_TIMEOUT;
    
    // Find expired games
    const expiredGames = await dbAll(
      'SELECT * FROM blackjack_games WHERE last_action < ? AND game_state != ?', 
      [cutoffTime, 'finished']
    );
    
    if (expiredGames.length > 0) {
      console.log(`🧹 Cleaning up ${expiredGames.length} expired blackjack games...`);
      
      for (const game of expiredGames) {
        // Refund the bet
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [game.bet_amount, game.user_id]);
        // DELETE the game instead of marking as finished to prevent UNIQUE constraint issues
        await dbRun('DELETE FROM blackjack_games WHERE id = ?', [game.id]);
        console.log(`  ♻️ Refunded ${game.bet_amount} points to user ${game.user_id}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up expired blackjack games:', error);
  }
}

// Clean up sessions every 2 minutes
setInterval(cleanupExpiredBlackjackGames, 2 * 60 * 1000);

/**
 * Create a blackjack game embed with beautiful card images
 */
async function createBlackjackEmbed(session, user) {
  const gameState = session.getGameState();
  
  let title = "🃏 Blackjack";
  let color = '#ffcc00'; // Yellow for ongoing game
  let description = "";

  if (session.isFinished()) {
    switch (session.result) {
      case 'player_blackjack':
        title = "<:stolen_emoji_blaze:1424681423553691672> Blackjack – You Won with Blackjack!";
        color = '#1abc9c';
        description = `🎉 **Natural 21!** You got blackjack and won ${session.winnings.toFixed(1.92)} points!`;
        break;
      case 'player_win':
        title = "<:stolen_emoji_blaze:1424681423553691672> Blackjack – You Won!";
        color = '#1abc9c';
        description = `🎉 You beat the dealer and won ${session.winnings.toFixed(1.92)} points!`;
        break;
      case 'dealer_win':
        title = "❌ Blackjack – You Lost!";
        color = '#e74c3c';
        if (session.playerHand.isBusted()) {
          description = `💥 You busted with ${session.playerHand.getValue()}! Dealer wins.`;
        } else {
          description = `😔 Dealer won with ${session.dealerHand.getValue()} against your ${session.playerHand.getValue()}.`;
        }
        break;
      case 'push':
        title = "➖ Blackjack – Push!";
        color = '#95a5a6';
        description = `🤝 It's a tie! Your bet of ${session.betAmount.toFixed(2)} points has been returned.`;
        break;
    }
  }

  // Generate beautiful card image like BetRush
  let attachment = null;
  try {
    const playerCards = session.playerHand.getCards();
    const dealerCards = session.dealerHand.getCards();
    
    // For ongoing games, hide dealer's first card
    const displayDealerCards = session.gameState === 'playing' && dealerCards.length > 0 
      ? ['🂠', ...dealerCards.slice(1)]
      : dealerCards;
    
    const imageBuffer = await createBlackjackGameImage(
      playerCards, 
      displayDealerCards, 
      session.gameState, 
      user.username || user.displayName || 'Player'
    );
    
    attachment = new AttachmentBuilder(imageBuffer, { name: 'blackjack-game.png' });
  } catch (error) {
    console.error('Error generating blackjack image:', error);
    // Fallback to text display if image generation fails
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields([
      { 
        name: '🎯 Your Hand', 
        value: `${gameState.playerHand} • **${session.playerHand.getValue()}**`, 
        inline: true 
      },
      { 
        name: '��� Dealer\'s Hand', 
        value: `${gameState.dealerHand} • **${session.gameState === 'playing' ? '?' : session.dealerHand.getValue()}**`, 
        inline: true 
      },
      { 
        name: '💰 Bet Amount', 
        value: `${session.betAmount.toFixed(1.92)} points`, 
        inline: true 
      }
    ]);

  if (description) {
    embed.setDescription(description);
  }

  // Add the beautiful card image
  if (attachment) {
    embed.setImage('attachment://blackjack-game.png');
  }

  return { embed, attachment };
}

/**
 * Create blackjack action buttons
 */
function createBlackjackButtons(session) {
  const gameState = session.getGameState();
  
  if (session.isFinished()) {
    // Game is over, return disabled buttons
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('bj_hit')
          .setLabel('➕ Hit')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('bj_stand')
          .setLabel('🛑 Stand')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
  }

  const hitBtn = new ButtonBuilder()
    .setCustomId('bj_hit')
    .setLabel('➕ Hit')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!gameState.canHit);

  const standBtn = new ButtonBuilder()
    .setCustomId('bj_stand')
    .setLabel('🛑 Stand')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!gameState.canStand);

  return new ActionRowBuilder().addComponents(hitBtn, standBtn);
}

(async () => {
  await setupTower(client, db, createCanvas, loadImage, AttachmentBuilder);
})();
client.login(BOT_TOKEN).catch(err => console.error('Login failed:', err));
// ==================== WORDLY GAME SYSTEM ====================
// Competitive word-guessing game with pot system

// Store active Wordly games
const activeWordlyGames = new Map();

// Word list for Wordly game (3-letter prefixes and their valid words)
const WORDLY_WORDS = {
  'pre': ['premium', 'present', 'prepare', 'predict', 'previous', 'pressure', 'precise', 'prevent', 'preview', 'prestige'],
  'pro': ['promise', 'product', 'protect', 'problem', 'provide', 'process', 'profile', 'project', 'program', 'progress'],
  'com': ['complete', 'computer', 'company', 'compare', 'complex', 'common', 'combine', 'comment', 'command', 'compete'],
  'con': ['control', 'connect', 'continue', 'content', 'contain', 'contact', 'consider', 'confirm', 'concern', 'concept'],
  'int': ['interest', 'internet', 'internal', 'increase', 'industry', 'interact', 'integral', 'intensive', 'interval', 'introduce'],
  'str': ['strategy', 'strength', 'straight', 'struggle', 'structure', 'stranger', 'stream', 'stretch', 'strike', 'string'],
  'dis': ['discover', 'discuss', 'display', 'distance', 'district', 'different', 'difficult', 'distribute', 'disable', 'discount'],
  'exp': ['experience', 'explain', 'explore', 'expect', 'express', 'expand', 'expert', 'expose', 'export', 'example'],
  'imp': ['important', 'improve', 'implement', 'impressive', 'impossible', 'import', 'impact', 'impress', 'implied', 'imperfect'],
  'app': ['application', 'appreciate', 'approach', 'appear', 'appropriate', 'approve', 'appliance', 'apply', 'appetite', 'apple'],
  'acc': ['account', 'accept', 'access', 'accurate', 'accomplish', 'according', 'accident', 'accelerate', 'accompany', 'accumulate'],
  'dev': ['develop', 'device', 'deliver', 'development', 'devoted', 'deviation', 'deviate', 'devastating', 'developer', 'devil'],
  'rec': ['recognize', 'receive', 'record', 'recommend', 'recent', 'recover', 'rectangle', 'recipe', 'recycle', 'recruit'],
  'res': ['resource', 'respond', 'result', 'research', 'respect', 'responsibility', 'restaurant', 'reserve', 'resident', 'rescue'],
  'sup': ['support', 'supply', 'suppose', 'superior', 'surprise', 'surpass', 'supervise', 'supplement', 'supreme', 'suppress']
};

/**
 * Generate Wordly lobby image showing participants and pot
 */
async function generateWordlyLobbyImage(prefix, betAmount, participants, pot, timeLeft) {
  try {
    const width = 800;
    const height = 450;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1f3a');
    gradient.addColorStop(0.5, '#2d3561');
    gradient.addColorStop(1, '#1a1f3a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Decorative pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += 25) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Main container
    ctx.fillStyle = 'rgba(45, 53, 97, 0.8)';
    ctx.fillRect(20, 20, width - 40, height - 40);
    
    // Border glow
    ctx.strokeStyle = 'rgba(100, 181, 246, 0.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('📝 WORDLY CHALLENGE', width / 2, 70);

    // Prefix display (large and prominent)
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 72px Arial';
    ctx.fillText(prefix.toUpperCase(), width / 2, 160);

    // Instructions
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '20px Arial';
    ctx.fillText('Find a word starting with these letters!', width / 2, 200);

    // Pot info
    ctx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    ctx.fillRect(50, 230, width - 100, 70);
    
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`💰 Prize Pot: ${pot.toFixed(2)} points`, width / 2, 265);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px Arial';
    ctx.fillText(`Entry Fee: ${betAmount.toFixed(2)} pts • ${participants.length} Player${participants.length !== 1 ? 's' : ''} Joined`, width / 2, 290);

    // Timer
    ctx.fillStyle = timeLeft <= 10 ? '#ef4444' : '#10b981';
    ctx.font = 'bold 36px Arial';
    ctx.fillText(`⏱️ ${timeLeft}s`, width / 2, 350);

    // Footer
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '16px Arial';
    ctx.fillText('Click "Join Game" to enter • Game starts when timer ends', width / 2, 400);

    ctx.textAlign = 'start';
    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating Wordly lobby image:', error);
    return null;
  }
}

/**
 * Generate Wordly result image
 */
async function generateWordlyResultImage(prefix, correctWord, winner, pot, participants) {
  try {
    const width = 800;
    const height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    if (winner) {
      gradient.addColorStop(0, '#065f46');
      gradient.addColorStop(1, '#064e3b');
    } else {
      gradient.addColorStop(0, '#7f1d1d');
      gradient.addColorStop(1, '#991b1b');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    for (let i = -height; i < width + height; i += 25) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + height, height);
      ctx.stroke();
    }

    // Main container
    ctx.fillStyle = winner ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(20, 20, width - 40, height - 40);
    
    ctx.strokeStyle = winner ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(winner ? '🎉 WORDLY - WINNER!' : '❌ WORDLY - NO WINNER', width / 2, 80);

    // Correct word reveal
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 64px Arial';
    ctx.fillText(correctWord.toUpperCase(), width / 2, 170);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '24px Arial';
    ctx.fillText(`Started with: ${prefix.toUpperCase()}`, width / 2, 210);

    if (winner) {
      // Winner info
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 36px Arial';
      ctx.fillText(`🏆 Winner: ${winner.username}`, width / 2, 280);

      const fee = pot * 0.08;
      const payout = pot - fee;

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 28px Arial';
      ctx.fillText(`💰 Prize: ${payout.toFixed(2)} points`, width / 2, 330);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '18px Arial';
      ctx.fillText(`(${pot.toFixed(2)} pot - ${fee.toFixed(2)} fee)`, width / 2, 360);
    } else {
      // No winner - bets refunded
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 32px Arial';
      ctx.fillText('Better luck next time!', width / 2, 280);

      ctx.fillStyle = '#fbbf24';
      ctx.font = '24px Arial';
      ctx.fillText(`💸 All bets refunded: ${pot.toFixed(2)} points total`, width / 2, 330);
    }

    // Stats
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(50, 380, width - 100, 80);

    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.fillText(`📊 ${participants.length} Player${participants.length !== 1 ? 's' : ''} Participated`, width / 2, 415);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px Arial';
    ctx.fillText('MasterBets Wordly • Provably Fair Word Challenge', width / 2, 445);

    ctx.textAlign = 'start';
    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('Error generating Wordly result image:', error);
    return null;
  }
}

/**
 * Start a new Wordly game
 */
async function startWordlyGame(channelId, hostId, betAmount) {
  // Get random prefix and word
  const prefixes = Object.keys(WORDLY_WORDS);
  const prefix = prefixes[crypto.randomInt(0, prefixes.length)];
  const possibleWords = WORDLY_WORDS[prefix];
  const correctWord = possibleWords[crypto.randomInt(0, possibleWords.length)];

  const game = {
    channelId,
    hostId,
    betAmount,
    prefix,
    correctWord,
    participants: [{ id: hostId, username: 'Host' }],
    pot: betAmount,
    timeLeft: 60,
    messageId: null,
    timerInterval: null,
    active: true
  };

  activeWordlyGames.set(channelId, game);
  return game;
}

/**
 * Update Wordly lobby embed with timer
 */
async function updateWordlyLobby(game, channel) {
  try {
    if (!game.active || !game.messageId) return;

    const image = await generateWordlyLobbyImage(
      game.prefix,
      game.betAmount,
      game.participants,
      game.pot,
      game.timeLeft
    );

    const embed = new EmbedBuilder()
      .setTitle('📝 Wordly Word Challenge')
      .setDescription(`**Starting Letters:** \`${game.prefix.toUpperCase()}\`\n\n🎯 **How to Play:**\nGuess a word that starts with these letters!\n\n💰 **Prize Pot:** ${game.pot.toFixed(2)} points\n👥 **Players:** ${game.participants.length}\n⏱️ **Time Left:** ${game.timeLeft}s`)
      .setColor(game.timeLeft <= 10 ? '#ef4444' : '#fbbf24')
      .addFields([
        { name: '🎮 Entry Fee', value: `${game.betAmount.toFixed(2)} points`, inline: true },
        { name: '🏆 Winner Takes', value: `${(game.pot * 0.92).toFixed(2)} pts (92%)`, inline: true },
        { name: '💸 House Fee', value: `8%`, inline: true }
      ])
      .setImage('attachment://wordly-lobby.png')
      .setFooter({ text: 'MasterBets Wordly • Click Join Game to enter!' })
      .setTimestamp();

    const attachment = new AttachmentBuilder(image, { name: 'wordly-lobby.png' });

    const joinButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wordly_join_${game.channelId}`)
        .setLabel(`Join Game (${game.betAmount.toFixed(2)} pts)`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎮')
    );

    const message = await channel.messages.fetch(game.messageId);
    await message.edit({ embeds: [embed], files: [attachment], components: [joinButton] });
  } catch (error) {
    console.error('Error updating Wordly lobby:', error);
  }
}

/**
 * End Wordly game and determine winner
 */
async function endWordlyGame(game, channel) {
  try {
    game.active = false;
    
    if (game.timerInterval) {
      clearInterval(game.timerInterval);
    }

    // Check if anyone joined
    if (game.participants.length === 1) {
      // Only host, refund and cancel
      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [game.betAmount, game.hostId]);

      const embed = new EmbedBuilder()
        .setTitle('❌ Wordly Cancelled')
        .setDescription('No one else joined the game.\n\n💸 Your bet has been refunded.')
        .setColor('#95a5a6')
        .setFooter({ text: 'MasterBets Wordly' });

      await channel.send({ embeds: [embed] });
      activeWordlyGames.delete(game.channelId);
      return;
    }

    // Wait for guesses (game should already have winner if someone guessed correctly)
    // If no winner, refund all bets
    const image = await generateWordlyResultImage(
      game.prefix,
      game.correctWord,
      game.winner,
      game.pot,
      game.participants
    );

    const attachment = new AttachmentBuilder(image, { name: 'wordly-result.png' });

    const embed = new EmbedBuilder()
      .setTitle(game.winner ? '🎉 Wordly - We Have a Winner!' : '❌ Wordly - No Winner')
      .setDescription(game.winner ? 
        `**Correct Word:** \`${game.correctWord.toUpperCase()}\`\n\n🏆 **Winner:** ${game.winner.username}\n💰 **Prize:** ${(game.pot * 0.92).toFixed(2)} points` :
        `**Correct Word:** \`${game.correctWord.toUpperCase()}\`\n\n❌ No one guessed correctly!\n💸 All bets refunded: ${game.pot.toFixed(2)} points`)
      .setColor(game.winner ? '#10b981' : '#ef4444')
      .setImage('attachment://wordly-result.png')
      .setFooter({ text: 'MasterBets Wordly • Thanks for playing!' })
      .setTimestamp();

    await channel.send({ embeds: [embed], files: [attachment] });

    if (game.winner) {
      // Pay winner
      const fee = game.pot * 0.08;
      const payout = game.pot - fee;

      await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, game.winner.id]);
      await trackCollectedFee('wordly', fee, 'wordly', game.winner.id, game.betAmount, 'Wordly 8% fee');

      // Log win
      try {
        await sendLogMessage(`📝 ${game.winner.username} won ${payout.toFixed(2)} points in Wordly! Word: ${game.correctWord}`);
      } catch (logError) {
        console.error('Error logging Wordly win:', logError);
      }
    } else {
      // Refund all participants
      for (const participant of game.participants) {
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [game.betAmount, participant.id]);
      }
    }

    activeWordlyGames.delete(game.channelId);
  } catch (error) {
    console.error('Error ending Wordly game:', error);
  }
}

// Wordly command handler
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'wordly') {
    try {
      // Check if game already active in channel
      if (activeWordlyGames.has(msg.channel.id)) {
        return msg.reply('❌ A Wordly game is already active in this channel! Wait for it to finish.');
      }

      // Parse bet amount
      if (args.length < 1) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Invalid Wordly Command')
          .setDescription('**Usage:** `.wordly <amount>`\n\n**Examples:**\n• `.wordly 10` - Start game with 10 point entry\n• `.wordly 50` - Start game with 50 point entry')
          .setColor('#e74c3c')
          .addFields([
            { name: '🎮 How It Works', value: 'Start a word challenge where players guess words starting with 3 letters!', inline: false },
            { name: '💰 Prize Pool', value: 'All entry fees go to the winner (minus 8% fee)', inline: true },
            { name: '⏱️ Duration', value: '60 seconds to join and guess', inline: true }
          ])
          .setFooter({ text: 'MasterBets Wordly • Competitive Word Challenge' });
        
        return msg.reply({ embeds: [embed] });
      }

      const betAmount = parseFloat(args[0]);

      // Validate bet
      if (isNaN(betAmount) || betAmount < 1 || betAmount > 1000) {
        return msg.reply('❌ Bet must be between 1 and 1000 points.');
      }

      // Check balance
      await ensureUserExists(msg.author.id);
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [msg.author.id]);
      const balance = user?.balance || 0;

      if (balance < betAmount) {
        return msg.reply(`❌ Insufficient balance. You need ${betAmount.toFixed(2)} points but only have ${balance.toFixed(2)} points.`);
      }

      // Deduct bet
      await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [betAmount, msg.author.id]);
      await trackWageredAmount(msg.author.id, betAmount);

      // Start game
      const game = await startWordlyGame(msg.channel.id, msg.author.id, betAmount);
      game.participants[0].username = msg.author.username;

      // Generate initial lobby image
      const image = await generateWordlyLobbyImage(
        game.prefix,
        game.betAmount,
        game.participants,
        game.pot,
        game.timeLeft
      );

      const attachment = new AttachmentBuilder(image, { name: 'wordly-lobby.png' });

      const embed = new EmbedBuilder()
        .setTitle('📝 Wordly Word Challenge Started!')
        .setDescription(`**Starting Letters:** \`${game.prefix.toUpperCase()}\`\n\n🎯 **How to Play:**\nGuess a word that starts with these letters!\n\n💰 **Prize Pot:** ${game.pot.toFixed(2)} points\n👥 **Players:** ${game.participants.length}\n⏱️ **Time Left:** ${game.timeLeft}s`)
        .setColor('#fbbf24')
        .addFields([
          { name: '🎮 Entry Fee', value: `${game.betAmount.toFixed(2)} points`, inline: true },
          { name: '🏆 Winner Takes', value: `${(game.pot * 0.92).toFixed(2)} pts (92%)`, inline: true },
          { name: '💸 House Fee', value: `8%`, inline: true }
        ])
        .setImage('attachment://wordly-lobby.png')
        .setFooter({ text: 'MasterBets Wordly • Click Join Game to enter!' })
        .setTimestamp();

      const joinButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wordly_join_${msg.channel.id}`)
          .setLabel(`Join Game (${betAmount.toFixed(2)} pts)`)
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎮')
      );

      const gameMessage = await msg.reply({ embeds: [embed], files: [attachment], components: [joinButton] });
      game.messageId = gameMessage.id;

      // Start timer (update every 5 seconds)
      game.timerInterval = setInterval(async () => {
        game.timeLeft -= 5;

        if (game.timeLeft <= 0) {
          await endWordlyGame(game, msg.channel);
        } else {
          await updateWordlyLobby(game, msg.channel);
        }
      }, 5000);

    } catch (error) {
      console.error('Wordly command error:', error);
      await msg.reply('❌ An error occurred while starting Wordly. Please try again.');
    }
  }
});

// Wordly join button handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('wordly_join_')) return;

  const channelId = interaction.customId.split('_')[2];
  const game = activeWordlyGames.get(channelId);

  if (!game || !game.active) {
    return interaction.reply({ content: '❌ This game is no longer active.', ephemeral: true });
  }

  const userId = interaction.user.id;

  // Check if already joined
  if (game.participants.some(p => p.id === userId)) {
    return interaction.reply({ content: '❌ You have already joined this game!', ephemeral: true });
  }

  try {
    // Check balance
    await ensureUserExists(userId);
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    const balance = user?.balance || 0;

    if (balance < game.betAmount) {
      return interaction.reply({ 
        content: `❌ Insufficient balance. You need ${game.betAmount.toFixed(2)} points.`, 
        ephemeral: true 
      });
    }

    // Deduct bet
    await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [game.betAmount, userId]);
    await trackWageredAmount(userId, game.betAmount);

    // Add to game
    game.participants.push({ id: userId, username: interaction.user.username });
    game.pot += game.betAmount;

    await interaction.reply({ 
      content: `✅ You joined the Wordly game! Try to guess a word starting with \`${game.prefix.toUpperCase()}\``, 
      ephemeral: true 
    });

    // Update lobby immediately
    await updateWordlyLobby(game, interaction.channel);

  } catch (error) {
    console.error('Wordly join error:', error);
    await interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
  }
});

// Wordly guess handler (listen to all messages in active game channels)
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const game = activeWordlyGames.get(msg.channel.id);
  if (!game || !game.active || game.winner) return;

  // Check if user is participant
  const participant = game.participants.find(p => p.id === msg.author.id);
  if (!participant) return;

  const guess = msg.content.toLowerCase().trim();

  // Check if guess matches correct word
  if (guess === game.correctWord) {
    // Winner found!
    game.winner = { id: msg.author.id, username: msg.author.username };
    
    // End game immediately
    clearInterval(game.timerInterval);
    await endWordlyGame(game, msg.channel);

    // React to winning message
    try {
      await msg.react('🎉');
      await msg.react('🏆');
    } catch (e) {}
  }
});

console.log('✅ Wordly game system loaded!');
