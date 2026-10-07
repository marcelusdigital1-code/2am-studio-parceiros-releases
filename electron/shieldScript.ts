/**
 * Módulo de Segurança e Blindagem para o Chrome Real (agent-windows)
 * Protege contra acesso indevido a perfis, menus de logout, definições,
 * monetização e navegação fora de telas seguras de upload (TikTok, YouTube Studio, Facebook Reels).
 */
export const POST_LOGIN_CSS = `
/* ==========================================================================
   BLINDAGEM GERAL DE SEGURANÇA - TODAS AS PLATAFORMAS (TIKTOK, YOUTUBE, FACEBOOK)
   ========================================================================== */

/* 0. Salvaguarda Estrita: Containers vitais de formulário, upload, rodapé e botão Publicar NUNCA devem ser ocultados */
#root,
body,
html,
[class*="upload-container" i],
[class*="stage-container" i],
[class*="editor-container" i],
[class*="upload-wrapper" i],
[class*="upload-card" i],
[class*="upload-stage" i],
[class*="layout-main" i],
[class*="main-content" i],
[class*="footer-actions" i],
[class*="publish-actions" i],
[class*="btn-footer" i],
[class*="button-group" i],
[class*="btn-group" i],
[class*="btn-post" i],
button[data-e2e="post_video_button"],
[data-e2e="post_video_button"],
[class*="TUXButton--primary" i] {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}

/* 1. Bloqueio Absoluto de Logout, Terminar Sessão, Sair e Alternar Contas */
[data-e2e="logout-menu-item"],
[data-e2e="logout"],
[data-e2e="logout-icon"],
[data-e2e="logout-btn"],
[data-e2e*="logout"],
[data-e2e*="signout"],
[data-e2e*="sign-out"],
[data-e2e*="log-out"],
[data-testid*="logout"],
[data-testid*="signout"],
[aria-label*="Terminar sessão" i],
[aria-label*="Terminar sessao" i],
[aria-label*="Log out" i],
[aria-label*="Logout" i],
[aria-label*="Sign out" i],
[aria-label*="Sair" i],
[aria-label*="Encerrar sessão" i],
[aria-label*="Encerrar sessao" i],
[title*="Terminar sessão" i],
[title*="Terminar sessao" i],
[title*="Log out" i],
[title*="Logout" i],
[title*="Sign out" i],
[title*="Sair" i],
[title*="Encerrar sessão" i],
[title*="Encerrar sessao" i],
a[href*="/logout"],
a[href*="/signout"],
a[href*="logout"],
a[href*="signout"],
div[class*="logout" i],
button[class*="logout" i],
li[class*="logout" i],
span[class*="logout" i],
div[role="menuitem"][aria-label*="Terminar sessão" i],
div[role="menuitem"][aria-label*="Log Out" i],
div[role="menuitem"][aria-label*="Sair" i],
header [aria-label*="terminar" i],
header [aria-label*="logout" i],
header [aria-label*="sair" i],
header [title*="terminar" i],
header [title*="logout" i],
header [title*="sair" i],
header [class*="logout" i],
header button:has([aria-label*="terminar" i]),
header button:has([aria-label*="logout" i]),
div[class*="header" i] [class*="logout" i],
div[class*="header" i] [aria-label*="terminar" i],
div[class*="header" i] [aria-label*="logout" i],
div[class*="header" i] [title*="terminar" i],
div[class*="header" i] [title*="logout" i] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 2. TikTok Studio & Web - Canto Superior Direito (Avatar, Perfil, Menu de Conta, Terminar Sessão) */
[data-e2e*="profile-icon"],
[data-e2e*="nav-profile"],
[data-e2e="user-avatar"],
[data-e2e="profile-dropdown"],
[data-e2e="profile-menu"],
[data-e2e*="user-info"],
[data-e2e*="user_info"],
[data-e2e*="logout"],
[data-e2e*="signout"],
[data-e2e*="sign-out"],
[data-e2e*="log-out"],
header [class*="avatar" i],
header [class*="profile" i],
header [class*="user" i],
header [class*="user-info" i],
header [class*="account" i],
header [class*="logout" i],
div[class*="header" i] [class*="avatar" i],
div[class*="header" i] [class*="user" i],
div[class*="header" i] [class*="profile" i],
div[class*="header" i] [class*="user-info" i],
div[class*="header" i] [class*="logout" i],
div[class*="Header" i] [class*="avatar" i],
div[class*="Header" i] [class*="user" i],
div[class*="Header" i] [class*="profile" i],
div[class*="Header" i] [class*="user-info" i],
div[class*="Header" i] [class*="logout" i],
div[role="banner"] [class*="avatar" i],
div[role="banner"] [class*="user" i],
div[role="banner"] [class*="profile" i],
div[role="banner"] [class*="user-info" i],
div[role="banner"] [class*="logout" i],
div[data-e2e*="header"] [class*="avatar" i],
div[data-e2e*="header"] [class*="profile" i],
div[data-e2e*="header"] [class*="user" i],
div[data-e2e*="header"] [class*="logout" i],
[class*="avatar-wrapper" i],
[class*="avatarWrapper" i],
[class*="profile-avatar" i],
[class*="profileAvatar" i],
[class*="user-avatar" i],
[class*="userAvatar" i],
[class*="account-menu" i],
[class*="accountMenu" i],
[class*="tiktok-avatar" i],
[class*="profile-dropdown" i],
[class*="avatar-dropdown" i],
[class*="profile-entry" i],
[class*="profileEntry" i],
[class*="menu-logout" i],
header a[href*="/@"],
div[class*="header" i] a[href*="/@"],
div[class*="Header" i] a[href*="/@"],
header img[src*="tiktokcdn"],
div[class*="header" i] img[src*="tiktokcdn"],
div[class*="Header" i] img[src*="tiktokcdn"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 3. TikTok Studio - Sidebar (Crescimento, Ferramentas, Outros, Voltar ao TikTok, Smart Split Banner) */
[data-e2e="growth-section"],
[data-e2e*="growth"],
[data-e2e="inspiration"],
[data-e2e*="inspiration"],
[data-testid*="inspiration"],
a[href*="/inspiration"],
a[href*="inspiration"],
[data-e2e="creator-academy"],
[data-e2e*="academy"],
a[href*="/academy"],
a[href*="academy"],
a[href*="/creators/academy"],
[data-e2e="tools-section-studio"],
[data-e2e="monetization"],
[data-e2e*="monetization"],
[data-testid*="monetization"],
a[href*="/monetization"],
a[href*="monetization"],
a[href*="/creator-monetization"],
a[href*="/rewards"],
a[href*="/revenue"],
[data-e2e="reward-analytics"],
[data-e2e="revenue-chart"],
[data-testid="revenue-chart"],
[data-e2e="reward-sources"],
[data-e2e="active-programs"],
[data-e2e="programs-for-you"],
[data-e2e="subscription-card"],
[data-e2e="gifts-card"],
a[href*="/subscription"],
a[href*="/gifts"],
button[data-e2e*="apply"],
button[data-e2e*="join"],
[data-e2e="audio-library"],
[data-e2e*="audio"],
[data-e2e*="sound"],
[data-testid*="sound"],
a[href*="/sound-library"],
a[href*="sound-library"],
a[href*="sound_library"],
a[href*="/audio"],
a[href*="/music"],
a[href*="/sound"],
[data-e2e="smart-split"],
[data-e2e*="smart-split"],
[data-e2e*="smartsplit"],
[data-testid*="smartsplit"],
a[href*="/tool/smartsplit"],
a[href*="smartsplit"],
a[href*="smart-split"],
a[href*="/smart-split"],
[class*="smartsplit" i],
[class*="smart-split" i],
div[class*="banner" i]:has(a[href*="smartsplit"]),
div[class*="Banner" i]:has(a[href*="smartsplit"]),
div[class*="banner" i]:has(a[href*="smart-split"]),
div[class*="Banner" i]:has(a[href*="smart-split"]),
[data-e2e="others-section-studio"],
[data-e2e="feedback"],
[data-e2e*="feedback"],
[data-testid*="feedback"],
a[href*="/feedback"],
a[href*="feedback"],
[data-e2e*="back-to-tiktok"],
[data-e2e*="back_to_tiktok"],
[data-testid*="back-to-tiktok"],
a[href*="tiktok.com"]:not([href*="tiktokstudio"]):not([href*="upload"]),
[data-e2e="edit-profile"],
[data-testid="edit-profile-btn"],
a[href*="/edit-profile"],
a[href*="/profile/edit"],
a[href*="/account/edit"],
[data-e2e="favorites-tab"],
[data-e2e*="estimated-reward"],
[data-e2e*="reward-metric"],
[data-testid*="estimated-reward"],
[data-e2e*="knowledge"],
[data-e2e*="promote-card"],
[data-testid*="knowledge"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 4. TikTok Web - Top Right Container (Obter Moedas, Obter App, Perfil Avatar) */
[data-e2e="get-coins"],
a[href*="/coin"],
[data-e2e="download-app"],
[aria-label*="Obter Moedas" i],
[aria-label*="Obter App" i],
[data-e2e="profile-menu"],
[data-e2e="profile-dropdown"],
[data-testid="profile-menu"],
[data-testid="profile-icon"],
a[href*="/exit"],
a[href*="/@"],
[data-e2e="settings-menu-item"],
[data-testid="settings"],
a[href*="/setting"],
a[href*="/privacy"],
[data-e2e="language-selector"],
a[href*="/language"],
a[href*="/region"],
[data-e2e="dark-mode-toggle"],
[role="switch"],
[data-e2e="tools-section"],
[data-e2e="tiktok-studio-link"],
a[href*="studio.tiktok.com"]:not([href*="upload"]),
a[href*="/studio"]:not([href*="upload"]),
[data-e2e="promote-post"],
a[href*="/promote"],
[data-e2e="live-tools"],
a[href*="/live"],
a[href*="/livestudio"],
[data-e2e="tiktok-shop"],
a[href*="/shop"],
a[href*="/seller"],
[data-e2e="others-section"],
[data-e2e="support-link"],
a[href*="/support"],
a[href*="/help"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 5. TikTok Web - Sidebar Navigation Items (A seguir, Amigos, LIVE, Mensagens, Atividade, Perfil, Mais, Footer) */
[data-e2e="nav-following"],
a[href*="/following"],
[data-e2e="nav-friends"],
a[href*="/friends"],
[data-e2e="nav-live"],
a[href*="/live"],
[data-e2e="nav-messages"],
a[href*="/messages"],
[data-e2e="nav-activity"],
a[href*="/activity"],
[data-e2e="nav-profile"],
a[href*="/@"],
[data-e2e="nav-more"],
[data-e2e="nav-footer"],
aside div[class*="Footer" i],
aside div[class*="footer" i],
nav div[class*="Footer" i],
nav div[class*="footer" i],
[class*="sidebar" i] div[class*="Footer" i],
[class*="sidebar" i] div[class*="footer" i],
li:has(> a[href*="/following"]),
li:has(> a[href*="/friends"]),
li:has(> a[href*="/live"]),
div[role="menuitem"]:has(> a[href*="/following"]),
div[role="menuitem"]:has(> a[href*="/friends"]),
div[role="menuitem"]:has(> a[href*="/live"]) {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 6. YouTube Studio - Top Bar (Guide Hamburger, Search, Ask Studio, Notification, Help, Avatar) */
ytcp-icon-button#menu-icon,
paper-icon-button#guide-button,
#guide-button,
[aria-label*="Guide" i],
ytcp-search,
#search-input,
input#search-input,
#search-box,
input[placeholder*="Search across your channel" i],
input[placeholder*="Pesquisar no canal" i],
[aria-label*="Ask Studio" i],
[data-tooltip-text*="Ask Studio" i],
ytcp-button[label*="Ask" i],
ytcp-header [aria-label*="Ask" i],
ytcp-header [aria-label*="Notification" i],
ytcp-header [aria-label*="Notificaç" i],
ytcp-header [aria-label*="Notificac" i],
ytcp-header [data-tooltip-text*="Notification" i],
ytcp-header #notification-button,
#notification-button,
ytcp-header [aria-label*="Help" i],
ytcp-header [aria-label*="Ajuda" i],
ytcp-header [data-tooltip-text*="Help" i],
ytcp-header [data-tooltip-text*="Ajuda" i],
ytcp-header a[href*="support.google.com"],
a[href*="support.google.com/youtube"],
#avatar-btn,
button#avatar-btn,
ytcp-button#avatar-btn,
ytcp-icon-button#avatar-btn,
yt-img-shadow#avatar,
[id="avatar-btn"],
[id="avatar"],
.yt-spec-avatar-shape,
img[src*="googleusercontent.com"],
img[src*="ytimg.com"],
button:has(img[alt*="profile" i]),
button:has(img[alt*="avatar" i]),
[aria-label="Account profile photo"],
[aria-label*="Google Account" i],
[aria-label*="Conta do Google" i],
[aria-label*="Account" i],
[aria-label*="Conta" i],
[aria-label*="Perfil" i],
[aria-label*="Profile" i],
ytd-topbar-menu-button-renderer,
ytd-multi-page-menu-renderer,
tp-yt-iron-dropdown:has(ytd-multi-page-menu-renderer),
iron-dropdown:has(ytd-multi-page-menu-renderer),
ytcp-popup-container ytd-multi-page-menu-renderer,
ytcp-header-profile-menu,
#profile-menu {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 7. YouTube Studio - Left Navigation Drawer (Channel Header, Analytics, Community, Subtitles, Copyright, Earn, Customization, Audio Library, Settings, Feedback) */
#channel-header,
[id="channel-header"],
ytcp-entity-page[id="channel-header"],
div#channel-header,
.channel-header,
ytcp-navigation-item[test-id="ANALYTICS"],
ytcp-navigation-item[test-id="COMMUNITY"],
ytcp-navigation-item[test-id="COMMENTS"],
ytcp-navigation-item[test-id="SUBTITLES"],
ytcp-navigation-item[test-id="COPYRIGHT"],
ytcp-navigation-item[test-id="EARN"],
ytcp-navigation-item[test-id="MONETIZATION"],
ytcp-navigation-item[test-id="CUSTOMIZATION"],
ytcp-navigation-item[test-id="PROMOTIONS"],
ytcp-navigation-item[test-id="CREATOR_MUSIC"],
ytcp-navigation-item[test-id="AUDIO_LIBRARY"],
ytcp-navigation-item[test-id="AUDIOLIBRARY"],
ytcp-navigation-item[test-id="SETTINGS"],
ytcp-navigation-item[test-id="settings"],
ytcp-navigation-item[test-id="SEND_FEEDBACK"],
ytcp-navigation-item[test-id="FEEDBACK"],
ytcp-navigation-item:has(a[href*="/copyright"]),
ytcp-navigation-item:has(a[href*="/monetization"]),
ytcp-navigation-item:has(a[href*="/earn"]),
ytcp-navigation-item:has(a[href*="/editing"]),
ytcp-navigation-item:has(a[href*="/promotions"]),
ytcp-navigation-item:has(a[href*="/music"]),
ytcp-navigation-item:has(a[href*="/audio"]),
ytcp-navigation-item:has(a[href*="/settings"]),
ytcp-navigation-item:has(a[href*="/permissions"]),
ytcp-navigation-item:has(a[href*="/subtitles"]),
ytcp-navigation-item:has(a[href*="/analytics"]),
ytcp-navigation-item:has(#settings-button),
#settings-item,
tp-yt-paper-icon-item#settings-item,
tp-yt-paper-icon-item[id="settings-item"],
tp-yt-paper-icon-item:has(#settings-item),
#bottom-section,
#bottom-section #settings-item,
#bottom-section tp-yt-paper-icon-item,
#settings-button,
ytcp-button#settings-button,
#feedback-button,
ytcp-button#feedback-button,
ytcp-icon-button[icon="settings"],
ytcp-icon-button[icon="icons:settings"],
paper-icon-button[icon="settings"],
iron-icon[icon="settings"],
#settings-dialog,
ytcp-settings-dialog,
ytcp-dialog[id="settings-dialog"],
a[href*="/copyright"],
a[href*="/monetization"],
a[href*="/earn"],
a[href*="/editing"],
a[href*="/promotions"],
a[href*="/music"],
a[href*="/audio"],
a[href*="/settings"],
a[href*="/permissions"],
a[href*="/branding"],
a[href*="/basic"],
a[href*="/memberships"],
a[test-id="settings-menu-item"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 8. YouTube Studio - Dashboard Actions & Cards (Go Live, Create Post/Pencil, Post Card, Revenue Cards) */
ytcp-button:has([icon*="live"]),
ytcp-button:has([aria-label*="live" i]),
[aria-label*="Go live" i],
[aria-label*="Transmitir ao vivo" i],
ytcp-button:has([icon*="edit"]),
[aria-label*="Create post" i],
[aria-label*="Criar publicação" i],
[aria-label*="Criar publicacao" i],
ytcp-card:has(#create-post-button),
ytcp-button#create-post-button,
tp-yt-paper-tab:has(a[href*="revenue"]),
tp-yt-paper-tab:has(a[href*="tab-revenue"]),
tp-yt-paper-tab[test-id="REVENUE"],
[test-id="estimated-revenue-card"],
[aria-label*="Receita estimada" i],
[aria-label*="Estimated revenue" i],
[aria-label*="Receita" i],
[aria-label*="Revenue" i] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 9. Facebook - Blindagem Estrita de Página, Feed, Menus de Conta e Logout */
div[role="banner"] a[aria-label*="Facebook" i],
div[role="banner"] a[href="/"],
div[role="banner"] [aria-label*="Página inicial" i],
div[role="banner"] [aria-label*="Home" i],
div[role="banner"] [aria-label*="Amigos" i],
div[role="banner"] [aria-label*="Vídeos" i],
div[role="banner"] [aria-label*="Watch" i],
div[role="banner"] [aria-label*="Marketplace" i],
div[role="banner"] [aria-label*="Grupos" i],
div[role="banner"] [aria-label*="Gaming" i],
div[role="banner"] [aria-label*="Messenger" i],
div[role="banner"] [aria-label*="Notificações" i],
div[role="banner"] [aria-label*="Notifications" i],
div[role="banner"] [aria-label*="A tua foto" i],
div[role="banner"] [aria-label*="Sua foto" i],
div[role="banner"] [aria-label*="Your profile" i],
div[role="banner"] [aria-label*="Conta" i],
div[role="banner"] [aria-label*="Account" i],
div[role="banner"] [aria-label*="Perfil" i],
div[role="banner"] [aria-label*="Profile" i],
div[role="banner"] [aria-label*="Menu do Facebook" i],
div[role="banner"] [aria-label*="Controles da conta" i],
div[role="banner"] [aria-label*="Controlos da conta" i],
div[role="banner"] [role="button"]:has(img),
div[role="banner"] [role="button"]:has(image),
div[role="banner"] svg:has(image),
div[data-pagelet="LeftRail"] a[href="/"],
div[data-pagelet="LeftRail"] a[href*="/friends"],
div[data-pagelet="LeftRail"] a[href*="/groups"],
div[data-pagelet="LeftRail"] a[href*="/marketplace"],
div[data-pagelet="LeftRail"] a[href*="/watch"],
div[data-pagelet="LeftRail"] a[href*="/memories"],
div[data-pagelet="LeftRail"] a[href*="/saved"],
div[data-pagelet="LeftRail"] a[href*="/events"],
div[data-pagelet="LeftRail"] a[href*="/ads"],
div[data-pagelet="LeftRail"] a[href*="adsmanager"],
a[href*="/monetization"],
a[href*="/payouts"],
a[href*="/billing"],
a[href*="/insights/earnings"],
div[role="navigation"] a[href*="monetiz"],
div[data-testid*="monetization"],
div[aria-label*="Monetização" i],
div[aria-label*="Monetization" i],
div[aria-label*="Ganhos" i],
div[aria-label*="Earnings" i],
div[aria-label*="Estrelas" i],
div[aria-label*="Stars" i],
div[aria-label*="Anúncios nos Reels" i],
div[aria-label*="Ads on Reels" i],
a[href*="/ads"],
a[href*="/ad_center"],
a[href*="adsmanager"],
div[aria-label*="Turbinar" i],
div[aria-label*="Boost" i],
div[aria-label*="Desativar modo profissional" i],
div[aria-label*="Turn off professional mode" i],
a[href*="turn_off_professional_mode"],
a[href*="accountscenter.facebook.com"],
a[href*="/settings"],
a[href*="/security"],
a[href*="/privacy"],
div[role="menuitem"][aria-label*="Terminar sessão" i],
div[role="menuitem"][aria-label*="Log Out" i],
div[role="menuitem"][aria-label*="Sair" i],
div[role="menuitem"][aria-label*="Mudar de perfil" i],
div[role="menuitem"][aria-label*="Trocar de perfil" i],
div[role="menuitem"][aria-label*="Switch profile" i],
div[role="menuitem"][aria-label*="Definições" i],
div[role="menuitem"][aria-label*="Configurações" i],
div[role="menuitem"][aria-label*="Settings" i],
div[aria-label*="Definições e privacidade" i],
div[aria-label*="Configurações e privacidade" i],
a[aria-label*="Facebook"][href="/"],
a[href="/"],
a[href*="/friends"],
a[href*="/groups"],
a[href*="/marketplace"],
a[href*="/gaming"],
a[href*="/watch"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Preservar área principal de conteúdo, posts e gestão no Facebook */
div[role="main"],
div[data-pagelet="RightRail"],
div[data-pagelet*="Feed"],
div[data-pagelet*="Profile"],
div[data-pagelet*="Timeline"],
div[data-pagelet*="Main"] {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}

/* ═══════════════════════════════════════════
   INSTAGRAM — Blindagem de Segurança
   Explorar (/explore/) está VISÍVEL e acessível
   ═══════════════════════════════════════════ */
a[href*="/direct/"],
a[href*="/accounts/edit"],
a[href*="/accounts/privacy"],
a[href*="/accounts/security"],
a[href*="/accounts/password"],
a[href*="/accounts/manage"],
a[href*="/accounts/push"],
a[href*="/accounts/logout"],
a[href*="/ads/"],
a[href*="/monetization/"],
a[href*="/shop/"],
nav a[href*="/direct/"],
header button[aria-label*="Direct" i],
header button[aria-label*="Mensagens" i],
header button[aria-label*="Messages" i],
[aria-label*="Abrir câmara" i],
[aria-label*="Open camera" i] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Preservar SEMPRE: feed, Explorar, wizard de publicação */
div[role="dialog"],
div[role="dialog"] *,
input[type="file"] {
  display: revert !important;
  visibility: revert !important;
  opacity: revert !important;
  pointer-events: revert !important;
}
`;
export const SHADOW_CSS = `
/* Bloqueio Absoluto Terminar Sessão / Logout */
[data-e2e="logout-menu-item"],
[data-e2e="logout"],
[data-e2e*="logout"],
[data-e2e*="signout"],
[aria-label*="Terminar sessão" i],
[aria-label*="Log out" i],
[aria-label*="Sair" i],
[title*="Terminar sessão" i],
[title*="Log out" i],
[title*="Sair" i],
a[href*="/logout"],
a[href*="/signout"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* YouTube Studio Header inside Shadow DOM */
ytcp-header-profile-menu,
#profile-menu,
#avatar-btn,
button#avatar-btn,
ytcp-button#avatar-btn,
ytcp-icon-button#avatar-btn,
yt-img-shadow#avatar,
[id="avatar-btn"],
[id="avatar"],
.yt-spec-avatar-shape,
img[src*="googleusercontent.com"],
img[src*="ytimg.com"],
ytcp-icon-button#menu-icon,
paper-icon-button#guide-button,
#guide-button,
[aria-label*="Guide" i],
ytcp-search,
#search-input,
input#search-input,
#search-box,
input[placeholder*="Search across your channel" i],
input[placeholder*="Pesquisar no canal" i],
[aria-label*="Ask Studio" i],
[data-tooltip-text*="Ask Studio" i],
ytcp-button[label*="Ask" i],
#notification-button,
[aria-label*="Notification" i],
[aria-label*="Notificaç" i],
[aria-label*="Notificac" i],
[data-tooltip-text*="Notification" i],
[aria-label*="Help" i],
[aria-label*="Ajuda" i],
[data-tooltip-text*="Help" i],
[data-tooltip-text*="Ajuda" i],
a[href*="support.google.com"],
a[href*="support.google.com/youtube"],
[aria-label*="Google Account" i],
[aria-label*="Conta do Google" i],
[aria-label*="Gerir a sua Conta" i],
[aria-label*="Gerenciar sua Conta" i],
[aria-label*="Sua foto do perfil" i],
[aria-label*="Your profile" i],
[aria-label*="A tua foto do perfil" i],
ytd-multi-page-menu-renderer {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* YouTube Studio Drawer inside Shadow DOM */
#channel-header,
[id="channel-header"],
ytcp-entity-page[id="channel-header"],
div#channel-header,
.channel-header,
ytcp-navigation-item[test-id="ANALYTICS"],
ytcp-navigation-item[test-id="COMMUNITY"],
ytcp-navigation-item[test-id="COMMENTS"],
ytcp-navigation-item[test-id="SUBTITLES"],
ytcp-navigation-item[test-id="COPYRIGHT"],
ytcp-navigation-item[test-id="EARN"],
ytcp-navigation-item[test-id="MONETIZATION"],
ytcp-navigation-item[test-id="CUSTOMIZATION"],
ytcp-navigation-item[test-id="PROMOTIONS"],
ytcp-navigation-item[test-id="CREATOR_MUSIC"],
ytcp-navigation-item[test-id="AUDIO_LIBRARY"],
ytcp-navigation-item[test-id="AUDIOLIBRARY"],
ytcp-navigation-item[test-id="SETTINGS"],
ytcp-navigation-item[test-id="settings"],
ytcp-navigation-item[test-id="SEND_FEEDBACK"],
ytcp-navigation-item[test-id="FEEDBACK"],
ytcp-navigation-item:has(a[href*="/copyright"]),
ytcp-navigation-item:has(a[href*="/monetization"]),
ytcp-navigation-item:has(a[href*="/earn"]),
ytcp-navigation-item:has(a[href*="/editing"]),
ytcp-navigation-item:has(a[href*="/promotions"]),
ytcp-navigation-item:has(a[href*="/music"]),
ytcp-navigation-item:has(a[href*="/audio"]),
ytcp-navigation-item:has(a[href*="/settings"]),
ytcp-navigation-item:has(a[href*="/permissions"]),
ytcp-navigation-item:has(a[href*="/subtitles"]),
ytcp-navigation-item:has(a[href*="/analytics"]),
ytcp-navigation-item:has(#settings-button),
#settings-item,
tp-yt-paper-icon-item#settings-item,
tp-yt-paper-icon-item[id="settings-item"],
tp-yt-paper-icon-item:has(#settings-item),
#bottom-section,
#bottom-section #settings-item,
#bottom-section tp-yt-paper-icon-item,
#settings-button,
ytcp-button#settings-button,
#feedback-button,
ytcp-button#feedback-button,
ytcp-icon-button[icon="settings"],
ytcp-icon-button[icon="icons:settings"],
paper-icon-button[icon="settings"],
iron-icon[icon="settings"],
#settings-dialog,
ytcp-settings-dialog,
ytcp-dialog[id="settings-dialog"],
a[href*="/copyright"],
a[href*="/monetization"],
a[href*="/earn"],
a[href*="/editing"],
a[href*="/promotions"],
a[href*="/music"],
a[href*="/audio"],
a[href*="/settings"],
a[href*="/permissions"],
a[href*="/branding"],
a[href*="/basic"],
a[href*="/memberships"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* YouTube Studio Dashboard actions inside Shadow DOM */
ytcp-button:has([icon*="live"]),
ytcp-button:has([aria-label*="live" i]),
[aria-label*="Go live" i],
[aria-label*="Transmitir ao vivo" i],
ytcp-button:has([icon*="edit"]),
[aria-label*="Create post" i],
[aria-label*="Criar publicação" i],
ytcp-card:has(#create-post-button),
ytcp-button#create-post-button,
tp-yt-paper-tab[test-id="REVENUE"],
[test-id="estimated-revenue-card"],
[aria-label*="Receita estimada" i],
[aria-label*="Estimated revenue" i] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
`;
export const STEALTH_CSS = "\n/* Campos Cegos de Credenciais (E-mail, Senha, Nome) */\ninput[type=\"email\"], input[name=\"identifier\"], input[name=\"email\"], input[id=\"email\"], input[data-e2e=\"email-input\"],\ninput[name=\"Username\"], input[name=\"reg_email__\"], input[name=\"reg_email_confirmation__\"],\ninput[type=\"password\"], input[name=\"Passwd\"], input[name=\"PasswdAgain\"], input[name=\"password\"], input[name=\"pass\"], input[id=\"pass\"], input[name=\"reg_passwd__\"], input[data-e2e=\"password-input\"],\ninput[name=\"firstName\"], input[name=\"firstname\"], input[name=\"lastName\"], input[name=\"lastname\"] {\n  -webkit-text-security: disc !important;\n  text-security: disc !important;\n}\n";

/**
 * Script injetado via CDP para bloquear atalhos de teclado perigosos
 * e impedir que o parceiro abra novas janelas/abas, recarregue, aceda ao gestor de tarefas, etc.
 * Seguro para automação CDP (que usa Runtime.evaluate, não eventos reais de teclado).
 */
export const KEYBOARD_BLOCKER_SCRIPT = `(function() {
  if (window.__agentKbBlocker) return;
  window.__agentKbBlocker = true;
  document.addEventListener('keydown', function(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    // Ctrl+T (nova aba/janela do browser), Ctrl+N (nova janela),
    // Ctrl+R / F5 (recarregar), Ctrl+W (fechar aba),
    // Ctrl+F (localizar), Ctrl+P (imprimir), Ctrl+U (ver source),
    // Ctrl+Shift+J / Ctrl+Shift+I (DevTools), Shift+Esc (gestor de tarefas)
    if (ctrl) {
      var k = e.key ? e.key.toLowerCase() : '';
      if (k === 't' || k === 'n' || k === 'r' || k === 'w' ||
          k === 'f' || k === 'p' || k === 'u' || k === 'j' || k === 'i') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
    }
    if (e.shiftKey && (e.key === 'Escape' || e.key === 'F5')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
    if (e.key === 'F5' || e.key === 'F12') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);
})();`;

export interface ShieldOptions {
  isSignup?: boolean;
  email?: string;
  pass?: string;
  birthDate?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  lastCode?: string;
  pageUrl?: string;
}

export function buildChromeSecurityScript(options: ShieldOptions = {}): string {
    const isSignup = Boolean(options.isSignup);
    const email = options.email || '';
    const pass = options.pass || '';
    const birthDate = options.birthDate || '';
    const firstName = options.firstName || '';
    const lastName = options.lastName || '';
    const gender = options.gender || 'male';
    const lastCode = options.lastCode || '';
    const pageUrl = options.pageUrl || '';
    return `
    var POST_LOGIN_CSS = ${JSON.stringify(POST_LOGIN_CSS)};
    var SHADOW_CSS = ${JSON.stringify(SHADOW_CSS)};
    var STEALTH_CSS = ${JSON.stringify(STEALTH_CSS)};

    (function() {
      window.__AGENT_IS_SIGNUP__ = ${JSON.stringify(isSignup)};
      window.__AGENT_EMAIL__ = ${JSON.stringify(email)};
      window.__AGENT_PASS__ = ${JSON.stringify(pass)};
      window.__AGENT_DOB__ = ${JSON.stringify(birthDate)};
      window.__AGENT_FIRST_NAME__ = ${JSON.stringify(firstName)};
      window.__AGENT_LAST_NAME__ = ${JSON.stringify(lastName)};
      window.__AGENT_GENDER__ = ${JSON.stringify(gender)};
      window.__AGENT_LAST_CODE__ = ${JSON.stringify(lastCode)};
      window.__AGENT_PAGE_URL__ = ${JSON.stringify(pageUrl)};

      // 0. Injeção condicional de POST_LOGIN_CSS no documento (apenas se já autenticado)
      try {
        if (!window.__AGENT_IS_SIGNUP__ && typeof checkIsConnected === 'function' && checkIsConnected()) {
          var existingStyle = document.getElementById('agent-post-login-css');
          if (!existingStyle) {
            var s = document.createElement('style');
            s.id = 'agent-post-login-css';
            s.textContent = POST_LOGIN_CSS;
            (document.head || document.documentElement).appendChild(s);
          }
        }
      } catch(_) {}

      // 0. Hook Element.prototype.attachShadow para proteger Web Components e Shadow DOM do YouTube Studio
      if (!window.__AGENT_SHADOW_HOOKED__) {
        window.__AGENT_SHADOW_HOOKED__ = true;
        try {
          var origAttachShadow = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function() {
            var shadow = origAttachShadow.apply(this, arguments);
            try {
              var sStyle = document.createElement('style');
              sStyle.id = 'agent-shadow-css';
              sStyle.textContent = SHADOW_CSS;
              shadow.appendChild(sStyle);
            } catch(_) {}
            return shadow;
          };
        } catch(eHook) {}
      }

      function sanitizeTikTok() {
        if (!window.location.hostname.includes('tiktok.com')) return;
        try {
          function isProtected(node) {
            if (!node || node === document.body || node === document.documentElement || node.id === 'root') return true;
            var cls = (node.className || '').toString().toLowerCase();
            var id = (node.id || '').toLowerCase();
            if (
              cls.includes('upload') || cls.includes('stage') || cls.includes('editor') ||
              cls.includes('form') || cls.includes('layout-main') || cls.includes('main-content') ||
              cls.includes('footer') || cls.includes('btn') || cls.includes('button') ||
              cls.includes('publish') || cls.includes('post')
            ) return true;
            if (id.includes('upload') || id.includes('stage') || id.includes('editor') || id.includes('footer')) return true;
            return false;
          }

          // 1. Ocultar e eliminar imediatamente o botão "Terminar sessão" / "Log out" / "Sair" por atributos
          var logoutEls = document.querySelectorAll(
            '[data-e2e="logout"], [data-e2e="logout-icon"], [data-e2e="logout-btn"], ' +
            '[data-e2e="logout-menu-item"], [data-e2e*="logout"], [data-e2e*="signout"], ' +
            '[data-e2e*="sign-out"], [data-e2e*="log-out"], [data-testid*="logout"], ' +
            '[data-testid*="signout"], a[href*="/logout"], a[href*="/signout"], a[href*="logout"], ' +
            '[aria-label*="Terminar sessão" i], [aria-label*="Terminar sessao" i], ' +
            '[aria-label*="Log out" i], [aria-label*="Logout" i], [aria-label*="Sign out" i], ' +
            '[aria-label*="Sair" i], [aria-label*="Encerrar sessão" i], ' +
            '[title*="Terminar sessão" i], [title*="Terminar sessao" i], ' +
            '[title*="Log out" i], [title*="Logout" i], [title*="Sign out" i], [title*="Sair" i]'
          );
          for (var l = 0; l < logoutEls.length; l++) {
            var lNode = logoutEls[l];
            var lBox = lNode.closest('li, button, a, div[role="button"], div[role="menuitem"], div[class*="item" i], div[class*="Item" i], div[class*="nav" i], div[class*="menu" i], div[class*="popover" i], div[class*="dropdown" i]') || lNode;
            if (!isProtected(lBox)) {
              lBox.style.setProperty('display', 'none', 'important');
              lBox.style.setProperty('visibility', 'hidden', 'important');
              lBox.style.setProperty('opacity', '0', 'important');
              lBox.style.setProperty('pointer-events', 'none', 'important');
              lBox.setAttribute('data-blocked-by-agent', 'true');
              try { lBox.remove(); } catch(_) {}
            }
          }

          // 1.1 Varredura exaustiva de texto para "Terminar sessão" / "Log out" / "Sair" em qualquer nó do TikTok
          var allTextCandidates = document.querySelectorAll('button, a, div[role="button"], div[role="menuitem"], li, div[class*="item" i], div[class*="Item" i], span, p, div');
          for (var tc = 0; tc < allTextCandidates.length; tc++) {
            var tCandidate = allTextCandidates[tc];
            if (tCandidate.children.length > 2) continue;
            var tText = (tCandidate.innerText || tCandidate.textContent || '').trim().toLowerCase();
            if (!tText) continue;
            var isLogoutText = (
              tText === 'terminar sessão' || tText === 'terminar sessao' ||
              tText === 'log out' || tText === 'logout' || tText === 'sair' ||
              tText === 'sign out' || tText === 'sign-out' ||
              tText === 'encerrar sessão' || tText === 'encerrar sessao' ||
              ((tText.includes('terminar sessão') || tText.includes('terminar sessao')) && tText.length < 30) ||
              ((tText.includes('log out') || tText.includes('sign out')) && tText.length < 20)
            );
            if (isLogoutText) {
              var tCandidateBox = tCandidate.closest('li, div[role="menuitem"], div[class*="item" i], div[class*="Item" i], a, button, div[role="button"], div[class*="menu" i], div[class*="popover" i], div[class*="dropdown" i]') || tCandidate;
              if (!isProtected(tCandidateBox)) {
                tCandidateBox.style.setProperty('display', 'none', 'important');
                tCandidateBox.style.setProperty('visibility', 'hidden', 'important');
                tCandidateBox.style.setProperty('opacity', '0', 'important');
                tCandidateBox.style.setProperty('pointer-events', 'none', 'important');
                tCandidateBox.setAttribute('data-blocked-by-agent', 'true');
                try { tCandidateBox.remove(); } catch(_) {}
              }
            }
          }

          // 1.2 Ocultar Avatar e Container do Perfil / Botão de Logout no Canto Superior Direito
          var topHeaderAvatars = document.querySelectorAll(
            'header [class*="avatar" i], header [class*="profile" i], header [class*="user" i], ' +
            'header [class*="user-info" i], header [class*="account" i], header [class*="logout" i], ' +
            'header [aria-label*="terminar" i], header [aria-label*="logout" i], header [aria-label*="sair" i], ' +
            'header [title*="terminar" i], header [title*="logout" i], header [title*="sair" i], ' +
            'div[class*="header" i] [class*="avatar" i], div[class*="header" i] [class*="user" i], ' +
            'div[class*="header" i] [class*="profile" i], div[class*="header" i] [class*="user-info" i], ' +
            'div[class*="header" i] [class*="logout" i], ' +
            'div[class*="Header" i] [class*="avatar" i], div[class*="Header" i] [class*="user" i], ' +
            'div[class*="Header" i] [class*="profile" i], div[class*="Header" i] [class*="user-info" i], ' +
            'div[class*="Header" i] [class*="logout" i], ' +
            'div[role="banner"] [class*="avatar" i], div[role="banner"] [class*="user" i], ' +
            'div[role="banner"] [class*="profile" i], div[role="banner"] [class*="user-info" i], ' +
            'div[role="banner"] [class*="logout" i], ' +
            '[data-e2e*="profile-icon"], [data-e2e*="nav-profile"], [data-e2e="user-avatar"], ' +
            '[data-e2e="profile-dropdown"], [data-e2e="profile-menu"], ' +
            '[class*="avatar-wrapper" i], [class*="avatarWrapper" i], ' +
            '[class*="profile-avatar" i], [class*="profileAvatar" i], ' +
            '[class*="user-avatar" i], [class*="userAvatar" i], ' +
            '[class*="profile-entry" i], [class*="profileEntry" i], ' +
            '[class*="account-menu" i], [class*="accountMenu" i], ' +
            'header a[href*="/@"], div[class*="header" i] a[href*="/@"], div[class*="Header" i] a[href*="/@"], ' +
            'header img[src*="tiktokcdn"], div[class*="header" i] img[src*="tiktokcdn"], div[class*="Header" i] img[src*="tiktokcdn"]'
          );
          for (var ta = 0; ta < topHeaderAvatars.length; ta++) {
            var taEl = topHeaderAvatars[ta];
            var taBox = taEl.closest('[role="button"], a, button, div[class*="avatar" i], div[class*="profile" i], div[class*="user" i], div[class*="user-info" i], div[class*="logout" i]') || taEl;
            if (isProtected(taBox)) continue;
            taBox.style.setProperty('display', 'none', 'important');
            taBox.style.setProperty('visibility', 'hidden', 'important');
            taBox.style.setProperty('opacity', '0', 'important');
            taBox.style.setProperty('pointer-events', 'none', 'important');
            taBox.setAttribute('data-blocked-by-agent', 'true');
          }

          var isTtStudio = window.location.hostname.includes('studio.tiktok.com') || window.location.href.includes('tiktokstudio');
          if (isTtStudio) {
            // 2. TikTok Studio: Sidebar (Crescimento, Ferramentas, Outros, Voltar ao TikTok, Smart Split)
            var studioBadItems = document.querySelectorAll(
              'a[href*="inspiration" i], [data-e2e*="inspiration"], ' +
              'a[href*="academy" i], [data-e2e*="academy"], a[href*="creator-portal" i], ' +
              'a[href*="monetization" i], [data-e2e*="monetization"], a[href*="reward" i], a[href*="revenue" i], ' +
              'a[href*="sound" i], a[href*="audio" i], a[href*="music" i], [data-e2e*="sound"], ' +
              'a[href*="smartsplit" i], a[href*="smart-split" i], [data-e2e*="smartsplit"], [data-e2e*="smart-split"], ' +
              'a[href*="feedback" i], [data-e2e*="feedback"], ' +
              'a[href*="tiktok.com"]:not([href*="tiktokstudio"]):not([href*="upload"]), ' +
              '[data-e2e*="back-to-tiktok"], ' +
              '[aria-label*="inspira" i], [title*="inspira" i], ' +
              '[aria-label*="academi" i], [title*="academi" i], ' +
              '[aria-label*="monetiz" i], [title*="monetiz" i], ' +
              '[aria-label*="som" i], [title*="som" i], [aria-label*="áudio" i], [title*="áudio" i], ' +
              '[aria-label*="smart" i], [title*="smart" i], ' +
              '[aria-label*="feedback" i], [title*="feedback" i], ' +
              '[aria-label*="voltar" i], [title*="voltar" i]'
            );
            for (var s = 0; s < studioBadItems.length; s++) {
              var sEl = studioBadItems[s];
              var sBox = sEl.closest('li, div[class*="item" i], div[class*="Item" i], div[class*="nav" i], div[class*="menu" i], div[class*="card" i], div[class*="Card" i], div[class*="section" i]') || sEl;
              if (isProtected(sBox)) continue;
              sBox.style.setProperty('display', 'none', 'important');
              sBox.style.setProperty('visibility', 'hidden', 'important');
              sBox.style.setProperty('opacity', '0', 'important');
              sBox.style.setProperty('pointer-events', 'none', 'important');
              sBox.setAttribute('data-blocked-by-agent', 'true');
            }

            // Ocultação por texto para seções inteiras (CRESCIMENTO, FERRAMENTAS, OUTROS) APENAS NA SIDEBAR
            var allHeadings = document.querySelectorAll('aside div, aside p, aside span, aside h2, aside h3, aside h4, nav div, nav p, nav span, nav h2, nav h3, nav h4, [class*="sidebar" i] div, [class*="sidebar" i] p, [class*="sidebar" i] span');
            for (var h = 0; h < allHeadings.length; h++) {
              var hEl = allHeadings[h];
              if (hEl.children.length > 2) continue;
              var hTxt = (hEl.innerText || hEl.textContent || '').trim().toUpperCase();
              if (hTxt === 'CRESCIMENTO' || hTxt === 'GROWTH' || hTxt === 'FERRAMENTAS' || hTxt === 'TOOLS' || hTxt === 'OUTROS' || hTxt === 'OTHERS') {
                var sec = hEl.closest('div[class*="section" i], div[class*="group" i], div[class*="menu" i]') || hEl;
                if (!isProtected(sec)) {
                  sec.style.setProperty('display', 'none', 'important');
                  sec.style.setProperty('visibility', 'hidden', 'important');
                  sec.style.setProperty('pointer-events', 'none', 'important');
                  sec.style.setProperty('opacity', '0', 'important');
                }
              }
              if (hTxt.includes('SMART SPLIT') && (hEl.closest('div[class*="banner" i]') || hEl.querySelector('button, a'))) {
                var bBox = hEl.closest('div[class*="banner" i], [class*="smartsplit" i], [class*="smart-split" i]') || hEl;
                if (!isProtected(bBox)) {
                  bBox.style.setProperty('display', 'none', 'important');
                  bBox.style.setProperty('visibility', 'hidden', 'important');
                  bBox.style.setProperty('pointer-events', 'none', 'important');
                  bBox.style.setProperty('opacity', '0', 'important');
                }
              }
            }
          } else {
            // 3. TikTok Web (Feed Para ti, Explorar, etc.)
            // 3.1 Top Right Container: Obter Moedas, Obter App, Perfil Avatar
            var webTopRight = document.querySelectorAll(
              '[data-e2e="get-coins"], a[href*="/coin"], [data-e2e="download-app"], ' +
              '[data-e2e="profile-icon"], [data-e2e="nav-profile"], [data-e2e="profile-dropdown"], ' +
              'header [class*="HeaderRight" i] [class*="avatar" i], header [class*="header-right" i] [class*="avatar" i], ' +
              'header [class*="RightContainer" i] [class*="avatar" i], header [class*="right-container" i] [class*="avatar" i]'
            );
            for (var wtr = 0; wtr < webTopRight.length; wtr++) {
              var wtrEl = webTopRight[wtr];
              if (isProtected(wtrEl)) continue;
              wtrEl.style.setProperty('display', 'none', 'important');
              wtrEl.style.setProperty('visibility', 'hidden', 'important');
              wtrEl.style.setProperty('opacity', '0', 'important');
              wtrEl.style.setProperty('pointer-events', 'none', 'important');
            }

            // 3.2 Sidebar no TikTok Web: A seguir, Amigos, LIVE, Mensagens, Atividade, Perfil, Mais, Footer
            var webSidebarBad = document.querySelectorAll(
              'a[href*="/following"], [data-e2e="nav-following"], ' +
              'a[href*="/friends"], [data-e2e="nav-friends"], ' +
              'a[href*="/live"], [data-e2e="nav-live"], ' +
              'a[href*="/messages"], [data-e2e="nav-messages"], ' +
              'a[href*="/activity"], [data-e2e="nav-activity"], ' +
              'a[href*="/@"], [data-e2e="nav-profile"], ' +
              '[data-e2e="nav-more"], [data-e2e="nav-footer"], ' +
              'aside div[class*="Footer" i], aside div[class*="footer" i], nav div[class*="footer" i], [class*="sidebar" i] div[class*="footer" i]'
            );
            for (var wsb = 0; wsb < webSidebarBad.length; wsb++) {
              var wsbEl = webSidebarBad[wsb];
              var wsbBox = wsbEl.closest('li, div[class*="item" i], div[class*="Item" i], div[role="menuitem"], div[class*="nav" i], aside div[class*="footer" i], nav div[class*="footer" i], [class*="sidebar" i] div[class*="footer" i]') || wsbEl;
              if (isProtected(wsbBox)) continue;
              wsbBox.style.setProperty('display', 'none', 'important');
              wsbBox.style.setProperty('visibility', 'hidden', 'important');
              wsbBox.style.setProperty('opacity', '0', 'important');
              wsbBox.style.setProperty('pointer-events', 'none', 'important');
            }

            // 3.3 Varredura por texto na sidebar do TikTok Web
            var allNavNodes = document.querySelectorAll('nav a, aside a, [class*="sidebar" i] a, [class*="sidebar" i] li, [class*="sidebar" i] div');
            for (var nn = 0; nn < allNavNodes.length; nn++) {
              var nNode = allNavNodes[nn];
              if (nNode.children.length > 3) continue;
              var nTxt = (nNode.innerText || nNode.textContent || '').trim().toLowerCase();
              if (
                nTxt === 'a seguir' || nTxt === 'following' ||
                nTxt === 'amigos' || nTxt === 'friends' ||
                nTxt === 'live' ||
                nTxt === 'mensagens' || nTxt === 'messages' ||
                nTxt === 'atividade' || nTxt === 'activity' ||
                nTxt === 'perfil' || nTxt === 'profile' ||
                nTxt === 'mais' || nTxt === 'more' ||
                nTxt === 'empresa' || nTxt === 'programa' || nTxt === 'termos e políticas' ||
                nTxt.includes('© 2026 tiktok') || nTxt.includes('© tiktok')
              ) {
                var nBox = nNode.closest('li, a, div[class*="item" i], div[class*="Item" i], div[role="menuitem"]') || nNode;
                if (isProtected(nBox)) continue;
                nBox.style.setProperty('display', 'none', 'important');
                nBox.style.setProperty('visibility', 'hidden', 'important');
                nBox.style.setProperty('opacity', '0', 'important');
                nBox.style.setProperty('pointer-events', 'none', 'important');
              }
            }
          }
        } catch(eTt) {}
      }

      function sanitizeYouTubeStudio() {
        if (!window.location.hostname.includes('studio.youtube.com')) return;
        try {
          function qShadow(sel, root) {
            var r = root || document;
            var arr = [];
            try { arr = Array.from(r.querySelectorAll(sel)); } catch(_) {}
            try {
              var all = r.querySelectorAll('*');
              for (var i = 0; i < all.length; i++) {
                if (all[i].shadowRoot) {
                  arr = arr.concat(qShadow(sel, all[i].shadowRoot));
                }
              }
            } catch(_) {}
            return arr;
          }

          // 1. Top Bar: Hamburger guide, Search bar, Ask Studio, Notifications, Help, Profile Avatar
          var topBarBad = qShadow(
            'ytcp-icon-button#menu-icon, paper-icon-button#guide-button, #guide-button, [aria-label*="Guide" i], ' +
            'ytcp-search, #search-input, input#search-input, #search-box, ' +
            '[aria-label*="Ask Studio" i], [data-tooltip-text*="Ask Studio" i], ytcp-button[label*="Ask" i], ' +
            '#notification-button, [aria-label*="Notification" i], [aria-label*="Notificaç" i], [aria-label*="Notificac" i], ' +
            'ytcp-header [aria-label*="Help" i], ytcp-header [aria-label*="Ajuda" i], #help-button, ' +
            '#avatar-btn, button#avatar-btn, ytcp-button#avatar-btn, ytcp-icon-button#avatar-btn, yt-img-shadow#avatar, ' +
            'ytd-topbar-menu-button-renderer, ytcp-header-profile-menu, #profile-menu'
          );
          for (var tb = 0; tb < topBarBad.length; tb++) {
            var tbEl = topBarBad[tb];
            tbEl.style.setProperty('display', 'none', 'important');
            tbEl.style.setProperty('visibility', 'hidden', 'important');
            tbEl.style.setProperty('opacity', '0', 'important');
            tbEl.style.setProperty('pointer-events', 'none', 'important');
          }

          // 2. Left Drawer / Sidebar:
          // 2.1 Channel header (Avatar + "Your channel" + channel name)
          var chHeader = qShadow('#channel-header, [id="channel-header"], ytcp-entity-page[id="channel-header"], div#channel-header, .channel-header');
          for (var ch = 0; ch < chHeader.length; ch++) {
            chHeader[ch].style.setProperty('display', 'none', 'important');
            chHeader[ch].style.setProperty('visibility', 'hidden', 'important');
            chHeader[ch].style.setProperty('opacity', '0', 'important');
            chHeader[ch].style.setProperty('pointer-events', 'none', 'important');
          }

          // 2.2 Navigation items to HIDE (Analytics, Community, Subtitles, Copyright, Earn, Customization, Audio Library, Settings, Feedback)
          var navBad = qShadow(
            'ytcp-navigation-item[test-id="ANALYTICS"], ' +
            'ytcp-navigation-item[test-id="COMMUNITY"], ytcp-navigation-item[test-id="COMMENTS"], ' +
            'ytcp-navigation-item[test-id="SUBTITLES"], ' +
            'ytcp-navigation-item[test-id="COPYRIGHT"], ' +
            'ytcp-navigation-item[test-id="EARN"], ytcp-navigation-item[test-id="MONETIZATION"], ' +
            'ytcp-navigation-item[test-id="CUSTOMIZATION"], ' +
            'ytcp-navigation-item[test-id="PROMOTIONS"], ' +
            'ytcp-navigation-item[test-id="CREATOR_MUSIC"], ' +
            'ytcp-navigation-item[test-id="AUDIO_LIBRARY"], ytcp-navigation-item[test-id="AUDIOLIBRARY"], ' +
            'ytcp-navigation-item[test-id="SETTINGS"], ytcp-navigation-item[test-id="settings"], ' +
            'ytcp-navigation-item[test-id="SEND_FEEDBACK"], ytcp-navigation-item[test-id="FEEDBACK"], ' +
            '#settings-item, #settings-button, #feedback-button, #bottom-section'
          );
          for (var nb = 0; nb < navBad.length; nb++) {
            var nbEl = navBad[nb];
            nbEl.style.setProperty('display', 'none', 'important');
            nbEl.style.setProperty('visibility', 'hidden', 'important');
            nbEl.style.setProperty('opacity', '0', 'important');
            nbEl.style.setProperty('pointer-events', 'none', 'important');
          }

          // 3. Dashboard Content Area:
          // 3.1 Go Live button and Create Post / Edit button
          var dashActions = qShadow(
            'ytcp-button:has([icon*="live"]), ytcp-button:has([aria-label*="live" i]), [aria-label*="Go live" i], [aria-label*="Transmitir ao vivo" i], ' +
            'ytcp-button:has([icon*="edit"]), [aria-label*="Create post" i], [aria-label*="Criar publicação" i], ' +
            'ytcp-card:has(#create-post-button), ytcp-button#create-post-button, ' +
            'tp-yt-paper-tab[test-id="REVENUE"], [test-id="estimated-revenue-card"]'
          );
          for (var da = 0; da < dashActions.length; da++) {
            dashActions[da].style.setProperty('display', 'none', 'important');
            dashActions[da].style.setProperty('visibility', 'hidden', 'important');
            dashActions[da].style.setProperty('opacity', '0', 'important');
            dashActions[da].style.setProperty('pointer-events', 'none', 'important');
          }

          // 3.2 Neutralizar links externos como Creator Insider ("Watch on YouTube")
          var extLinks = qShadow('a[href*="youtube.com/watch"], a[href*="youtu.be"], a[href*="support.google.com"]');
          for (var el = 0; el < extLinks.length; el++) {
            var ext = extLinks[el];
            ext.removeAttribute('target');
            ext.setAttribute('data-target-blocked', 'true');
            ext.onclick = function(e) { e.preventDefault(); e.stopPropagation(); return false; };
            ext.style.setProperty('pointer-events', 'none', 'important');
            ext.style.setProperty('opacity', '0.5', 'important');
          }
        } catch(eYt) {}
      }

      function sanitizeFacebook() {
        if (!window.location.hostname.includes('facebook.com')) return;
        try {
          var banner = document.querySelector('div[role="banner"]');
          if (banner) {
            var badBannerBtns = banner.querySelectorAll(
              '[aria-label*="foto" i], [aria-label*="Conta" i], [aria-label*="Account" i], [aria-label*="Perfil" i], [aria-label*="Profile" i], [aria-label*="Menu" i], [aria-label*="Facebook" i], [role="button"]:has(img), [role="button"]:has(image), svg:has(image), input[type="search"], input[placeholder*="Pesquisar" i], input[placeholder*="Search" i]'
            );
            for (var b = 0; b < badBannerBtns.length; b++) {
              badBannerBtns[b].style.setProperty('display', 'none', 'important');
              badBannerBtns[b].style.setProperty('visibility', 'hidden', 'important');
              badBannerBtns[b].style.setProperty('opacity', '0', 'important');
              badBannerBtns[b].style.setProperty('pointer-events', 'none', 'important');
              badBannerBtns[b].setAttribute('data-blocked-by-agent', 'true');
            }
          }
          // Bloqueio apenas de links indesejados no LeftRail (NUNCA ocultar RightRail nem a área principal)
          var badRailLinks = document.querySelectorAll(
            'div[data-pagelet="LeftRail"] a[href="/"], div[data-pagelet="LeftRail"] a[href*="/friends"], div[data-pagelet="LeftRail"] a[href*="/groups"], div[data-pagelet="LeftRail"] a[href*="/marketplace"], div[data-pagelet="LeftRail"] a[href*="/watch"], div[data-pagelet="LeftRail"] a[href*="/memories"], div[data-pagelet="LeftRail"] a[href*="/saved"], div[data-pagelet="LeftRail"] a[href*="/events"], div[data-pagelet="LeftRail"] a[href*="/ads"], div[data-pagelet="LeftRail"] a[href*="adsmanager"]'
          );
          for (var r = 0; r < badRailLinks.length; r++) {
            badRailLinks[r].style.setProperty('display', 'none', 'important');
            badRailLinks[r].style.setProperty('visibility', 'hidden', 'important');
            badRailLinks[r].style.setProperty('opacity', '0', 'important');
            badRailLinks[r].style.setProperty('pointer-events', 'none', 'important');
          }

          // Auto-Alternância Inteligente para a Página do Facebook:
          // Se estiver na Página atribuída e o Facebook sugerir "Troque para a Página [Nome] para realizar mais ações [Alternar]",
          // o sistema aciona o clique automaticamente para que a sessão assuma a identidade de Administrador da Página!
          var allButtons = document.querySelectorAll('button, div[role="button"], a[role="button"]');
          for (var ab = 0; ab < allButtons.length; ab++) {
            var bEl = allButtons[ab];
            var bTxt = (bEl.innerText || bEl.textContent || '').trim().toLowerCase();
            var bAria = (bEl.getAttribute('aria-label') || '').toLowerCase();
            var isSwitchAction = (
              bTxt === 'alternar' || bTxt === 'switch' || bTxt === 'trocar' || bTxt === 'mudar' ||
              bTxt.includes('alternar agora') || bTxt.includes('switch now') || bTxt.includes('mudar agora') ||
              bAria.includes('alternar') || bAria.includes('switch') || bAria.includes('troque para') || bAria.includes('muda para') || bAria.includes('mudar para')
            );
            if (isSwitchAction) {
              var parentCard = bEl.closest('div[class*="card" i], div[class*="Card" i], div[role="region"], div[role="banner"]');
              var cardText = (parentCard ? (parentCard.innerText || parentCard.textContent || '') : '').toLowerCase();
              if (
                cardText.includes('troque para a página') || cardText.includes('troque para a pagina') ||
                cardText.includes('muda para a página') || cardText.includes('mudar para a página') ||
                cardText.includes('mude para a página') || cardText.includes('muda para a pagina') ||
                cardText.includes('switch to')
              ) {
                if (!bEl.hasAttribute('data-auto-switched')) {
                  bEl.setAttribute('data-auto-switched', 'true');
                  try { bEl.click(); } catch(_) {}
                }
              } else if (
                (bAria.includes('alternar para') || bAria.includes('mudar para') || bAria.includes('switch to')) &&
                !bAria.includes('página') && !bAria.includes('pagina') && !bAria.includes('page')
              ) {
                // Bloquear estritamente qualquer botão para voltar ao perfil pessoal
                bEl.style.setProperty('display', 'none', 'important');
                bEl.style.setProperty('visibility', 'hidden', 'important');
                bEl.style.setProperty('pointer-events', 'none', 'important');
                bEl.style.setProperty('opacity', '0', 'important');
                bEl.setAttribute('data-blocked-by-agent', 'true');
              }
            }
          }

          var badLinks = document.querySelectorAll(
            'a[href="/"], a[href*="/friends"], a[href*="/groups"], a[href*="/marketplace"], a[href*="/gaming"], a[href*="/watch"], a[href*="adsmanager"], a[href*="/ads"], a[href*="/monetization"], a[href*="/payouts"], a[href*="/billing"], a[href*="/settings"], a[href*="accountscenter"], a[href*="/me"]'
          );
          for (var l = 0; l < badLinks.length; l++) {
            badLinks[l].style.setProperty('display', 'none', 'important');
            badLinks[l].style.setProperty('visibility', 'hidden', 'important');
            badLinks[l].style.setProperty('opacity', '0', 'important');
            badLinks[l].style.setProperty('pointer-events', 'none', 'important');
            badLinks[l].setAttribute('data-blocked-by-agent', 'true');
          }
          var popups = document.querySelectorAll('div[role="menu"], div[role="dialog"]');
          for (var p = 0; p < popups.length; p++) {
            var pTxt = (popups[p].innerText || popups[p].textContent || '').toLowerCase();
            var isPageSwitchConfirm = (
              pTxt.includes('mudar para') || pTxt.includes('alternar para') || pTxt.includes('trocar para') || pTxt.includes('switch to')
            ) && (pTxt.includes('página') || pTxt.includes('pagina') || pTxt.includes('page'));
            if (!isPageSwitchConfirm && (pTxt.includes('terminar sessão') || pTxt.includes('log out') || pTxt.includes('mudar de perfil') || pTxt.includes('alternar perfil') || pTxt.includes('switch profile') || pTxt.includes('definições e privacidade') || pTxt.includes('configurações'))) {
              popups[p].style.setProperty('display', 'none', 'important');
              popups[p].style.setProperty('visibility', 'hidden', 'important');
              popups[p].style.setProperty('pointer-events', 'none', 'important');
              popups[p].setAttribute('data-blocked-by-agent', 'true');
            }
          }
        } catch(eFb) {}
      }

      function sanitizeInstagram() {
        if (!window.location.hostname.includes('instagram.com')) return;
        try {
          // 1. Ocultar botões de Logout / Sair
          var logoutEls = document.querySelectorAll(
            '[aria-label*="Terminar sessão" i], [aria-label*="Log out" i], ' +
            '[aria-label*="Sair" i], a[href*="/accounts/logout"]'
          );
          for (var l = 0; l < logoutEls.length; l++) {
            var lBox = logoutEls[l].closest('li, button, a, div[role="menuitem"]') || logoutEls[l];
            lBox.style.setProperty('display', 'none', 'important');
            lBox.style.setProperty('pointer-events', 'none', 'important');
            lBox.setAttribute('data-blocked-by-agent', 'true');
          }

          // 2. Ocultar links de DMs e configurações de conta
          // NOTA: /explore/ NÃO está aqui — Explorar é PERMITIDO
          var badLinks = document.querySelectorAll(
            'a[href="/direct/inbox/"], a[href*="/direct/"], ' +
            'a[href*="/accounts/edit"], a[href*="/accounts/privacy"], ' +
            'a[href*="/accounts/logout"], a[href*="/ads/"]'
          );
          for (var b = 0; b < badLinks.length; b++) {
            badLinks[b].style.setProperty('display', 'none', 'important');
            badLinks[b].style.setProperty('pointer-events', 'none', 'important');
          }

          // 3. Fechar popups de Sair / Logout — NUNCA fechar o wizard de Reel
          var dialogs = document.querySelectorAll('div[role="dialog"]');
          for (var d = 0; d < dialogs.length; d++) {
            var dTxt = (dialogs[d].innerText || dialogs[d].textContent || '').toLowerCase();
            var isUpload = (
              dTxt.includes('reel') || dTxt.includes('partilhar') || dTxt.includes('share') ||
              dTxt.includes('avançar') || dTxt.includes('next') || dTxt.includes('vídeo') ||
              dTxt.includes('legenda') || dTxt.includes('caption') || dTxt.includes('publicar') ||
              dTxt.includes('upload') || dTxt.includes('criar') || dTxt.includes('create') ||
              dTxt.includes('filtros') || dTxt.includes('filters') || dTxt.includes('cortar') ||
              dTxt.includes('crop')
            );
            var isCreatorGuide = dTxt.includes('conta profissional') || dTxt.includes('professional account') ||
              dTxt.includes('creator') || !!document.getElementById('agent-ig-creator-guide-css');
            if (!isUpload && !isCreatorGuide && (dTxt.includes('sair') || dTxt.includes('log out') || dTxt.includes('terminar sessão'))) {
              dialogs[d].style.setProperty('display', 'none', 'important');
              dialogs[d].setAttribute('data-blocked-by-agent', 'true');
            }
          }
        } catch(eIg) {}
      }

      function checkIsConnected() {
                        try {
                          var hostName = (window.location.hostname || '').toLowerCase();
                          var pathName = (window.location.pathname || '').toLowerCase();
                          var fullUrl = (window.location.href || '').toLowerCase();

                          // 1. Google Accounts / Telas de Login do Google -> NUNCA conectado
                          if (
                            hostName.includes('accounts.google.com') ||
                            pathName.includes('/servicelogin') ||
                            pathName.includes('/signin') ||
                            pathName.includes('/identifier') ||
                            pathName.includes('/v2/signin') ||
                            pathName.includes('/v3/signin') ||
                            pathName.includes('/challenge') ||
                            fullUrl.includes('servicelogin') ||
                            fullUrl.includes('/challenge/')
                          ) {
                            return false;
                          }

                          // 2. Telas explícitas de autenticação / registo / desafio 2FA -> Não conectado
                          var authKeywords = [
                            '/login', '/signin', '/sign-in', '/signup', '/sign-up', '/register',
                            '/checkpoint', '/two-step-verification', '/two-step', '/recovery',
                            '/phone-or-email', '/r.php', '/reg/'
                          ];
                          for (var i = 0; i < authKeywords.length; i++) {
                            if (pathName.includes(authKeywords[i])) return false;
                          }

                          // 3. Se houver campo de senha ou formulário de login visível na página -> ainda em tela de autenticação
                          var passInputs = document.querySelectorAll(
                            'input[type="password"], input[name*="Passwd" i], input[data-e2e="password-input"], ' +
                            'input[name="pass"], input[id="pass"], button[name="login"], form[action*="/login"], ' +
                            '#loginform, [data-testid="royal_login_button"]'
                          );
                          for (var p = 0; p < passInputs.length; p++) {
                            var pi = passInputs[p];
                            if (pi && (pi.offsetWidth > 0 || pi.offsetHeight > 0)) return false;
                          }

                          // 4. Se houver campo de código 2FA / verificação ativo na página -> aguardando código
                          var codeInputs = document.querySelectorAll('input[data-e2e="verify-input"], input[name*="code" i], input[placeholder*="código" i], input[placeholder*="code" i], input[autocomplete="one-time-code"]');
                          for (var c = 0; c < codeInputs.length; c++) {
                            var ci = codeInputs[c];
                            if (ci && (ci.offsetWidth > 0 || ci.offsetHeight > 0)) return false;
                          }

                          // 5. YOUTUBE STUDIO
                          if (hostName === 'studio.youtube.com' || hostName.endsWith('.studio.youtube.com')) {
                            var ytSignInBtn = document.querySelector('ytd-button-renderer a[href*="/signin"], a[aria-label*="Fazer login" i], a[aria-label*="Sign in" i]');
                            if (ytSignInBtn && (ytSignInBtn.offsetWidth > 0 || ytSignInBtn.offsetHeight > 0)) {
                              return false;
                            }
                            var ytStudioShell = document.querySelector('#main-menu, ytcp-navigation-drawer, ytcp-app, #channel-header, ytcp-header, #avatar-btn, ytcp-entity-page');
                            if (ytStudioShell) {
                              return true;
                            }
                            return false;
                          }

                          // 6. YOUTUBE GERAL
                          if (hostName.includes('youtube.com')) {
                            var ytAvatar = document.querySelector('#avatar-btn, yt-img-shadow#avatar, button#avatar-btn, a[aria-label*="Google Account" i], a[aria-label*="Conta do Google" i]');
                            var ytSignIn = document.querySelector('ytd-button-renderer a[href*="/signin"], a[aria-label*="Fazer login" i], a[aria-label*="Sign in" i]');
                            if (ytAvatar && (!ytSignIn || (ytSignIn.offsetWidth === 0 && ytSignIn.offsetHeight === 0))) {
                              return true;
                            }
                            return false;
                          }

                          // 7. FACEBOOK (Perfil Profissional e Páginas Atribuídas)
                          if (hostName.includes('facebook.com')) {
                            if (
                              pathName.includes('/login') ||
                              pathName.includes('/r.php') ||
                              pathName.includes('/reg') ||
                              pathName.includes('/checkpoint') ||
                              pathName.includes('/recover') ||
                              document.querySelector('input[name="email"], input[name="pass"], button[name="login"], #loginform, form[action*="/login"], input[id="email"], input[id="pass"]')
                            ) {
                              return false;
                            }
                            if (window.__AGENT_PAGE_URL__) {
                              var cleanPg = window.__AGENT_PAGE_URL__.toLowerCase()
                                .replace('https://www.facebook.com', '')
                                .replace('https://web.facebook.com', '')
                                .replace('https://facebook.com', '')
                                .replace('http://www.facebook.com', '')
                                .replace('http://web.facebook.com', '');
                              var pIdMatch = window.__AGENT_PAGE_URL__.match(/id=([0-9]+)/);
                              if (pIdMatch && window.location.href.includes(pIdMatch[1])) return true;
                              if (cleanPg.length > 2 && window.location.href.toLowerCase().includes(cleanPg.split('&')[0])) return true;
                            }
                            if (pathName.includes('/professional_dashboard') || pathName.includes('/pages') || pathName.includes('/reels/create') || pathName.includes('/composer')) return true;
                            var fbMarker = document.querySelector(
                              'div[aria-label="A tua foto do perfil"], div[aria-label="Sua foto do perfil"], div[aria-label="Your profile"], ' +
                              'div[aria-label="Conta"], div[aria-label="Account"], div[role="banner"], ' +
                              'a[href*="/pages"], a[href*="/professional_dashboard"], div[data-pagelet="LeftRail"]'
                            );
                            if (fbMarker) return true;
                            return true;
                          }

                          // 8. TIKTOK STUDIO & WEB
                          if (hostName.includes('tiktok.com')) {
                            if (
                              pathName.includes('/signup') ||
                              pathName.includes('/login') ||
                              pathName.includes('/phone-or-email') ||
                              document.querySelector('input[name="email"], input[data-e2e="email-input"], input[type="password"], input[data-e2e="verify-input"]')
                            ) {
                              return false;
                            }
                            if (pathName.includes('/tiktokstudio') || hostName.includes('studio.tiktok.com')) {
                              return true;
                            }
                            var ttMarker = document.querySelector('[data-e2e="profile-icon"], [data-e2e="upload-icon"], a[href*="/upload"], [data-e2e="nav-profile"]');
                            if (ttMarker) return true;
                            return false;
                          }

                          // 9. INSTAGRAM
                          if (hostName.includes('instagram.com')) {
                            if (pathName.includes('/accounts/login') || pathName.includes('/accounts/emailsignup')) return false;
                            var igCookies = document.cookie || '';
                            if (igCookies.includes('sessionid=') || igCookies.includes('ds_user_id=')) return true;
                            var igAvatar = document.querySelector(
                              'img[alt*="foto do perfil" i], img[alt*="profile picture" i], ' +
                              '[aria-label*="Perfil" i], [aria-label*="Profile" i]'
                            );
                            if (igAvatar) return true;
                          }

                          // 10. KWAI
                          if (hostName.includes('kwai.com')) {
                            var kwaiMarker = document.querySelector('div[class*="avatar"], div[class*="user-info"], a[href*="/user/"]');
                            if (kwaiMarker) return true;
                          }
                        } catch (err) {}
                        return false;
                      }
                      window.__checkIsConnected__ = checkIsConnected;

                      // ── PROTEÇÃO CONTRA ABERTURA DE JANELAS EXTERNAS / POPUPS ──
                      // 1. Sobrescrever window.open para bloquear completamente popups e novas janelas
                      window.open = function(url, target, features) {
                        console.warn('[SECURITY] window.open bloqueado pelo agente:', url);
                        return null;
                      };

                      // 2. Interceptar clique com botão do meio (auxclick / scroll wheel) que abre nova aba
                      document.addEventListener('auxclick', function(e) {
                        if (e.button === 1) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                          return false;
                        }
                      }, true);

                      // 3. Interceptar cliques em links com target="_blank" ou combinados com Ctrl/Shift/Cmd
                      document.addEventListener('click', function(e) {
                        var aTag = e.target && e.target.closest ? e.target.closest('a') : null;
                        if (!aTag) return;

                        var tAttr = (aTag.getAttribute('target') || '').toLowerCase();
                        var isNewWindow = tAttr === '_blank' || tAttr === '_new' || tAttr === 'blank' || e.ctrlKey || e.shiftKey || e.metaKey;

                        if (isNewWindow) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.stopImmediatePropagation();
                          console.warn('[SECURITY] Bloqueado clique para nova aba/janela externa:', aTag.href);
                          return false;
                        }

                        // Bloquear clique se for link para URL proibida
                        var href = aTag.getAttribute('href') || aTag.href || '';
                        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                          var resolved = '';
                          try { resolved = new URL(href, window.location.href).href; } catch(_) { resolved = href; }
                          if (typeof isBlockedUrl === 'function' && isBlockedUrl(resolved)) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            redirectToSafe(resolved);
                            return false;
                          }
                        }
                      }, true);

                      // 4. Remover continuamente target="_blank" de todos os links do DOM
                      function stripBlankTargets() {
                        try {
                          var bLinks = document.querySelectorAll('a[target="_blank"], a[target="_new"], a[target="blank"]');
                          for (var bl = 0; bl < bLinks.length; bl++) {
                            bLinks[bl].removeAttribute('target');
                            bLinks[bl].setAttribute('data-target-blocked', 'true');
                          }
                        } catch(_) {}
                      }
                      setInterval(stripBlankTargets, 500);

                      // ── Bloqueios de Interface e Redirecionamento Ativo (TikTok, YouTube & Facebook) ──
                      // ATIVADO APENAS APÓS O PARCEIRO ESTAR CONECTADO/AUTENTICADO COM A CONTA
                      var BLOCKED_TEXT_KEYWORDS = [
                        // Dropdown de perfil (superior direito)
                        'ver perfil', 'view profile',
                        'terminar sessão', 'terminar sessao', 'log out', 'logout', 'sair',
                        // Menu lateral - Configurações, Idioma, Modo escuro
                        'configurações', 'configuracoes', 'settings',
                        'português', 'english',
                        'modo escuro', 'dark mode',
                        // Ferramentas TikTok Web
                        'tiktok studio',
                        'promover publicação', 'promover publicacao', 'promote post', 'promover', 'promote',
                        'ferramentas live', 'live tools',
                        'obter moedas', 'get coins',
                        'vender no tiktok shop', 'tiktok shop',
                        // Outros TikTok Web
                        'suporte', 'support',
                        // TikTok Studio - Rodapé do menu lateral
                        'voltar ao tiktok', 'voltar para o tiktok', 'back to tiktok',
                        // TikTok Studio - Crescimento (Sidebar e Dashboard)
                        'inspiração', 'inspiracao', 'inspiration',
                        'academia de criadores', 'creator academy',
                        // TikTok Studio - Ferramentas
                        'monetização', 'monetizacao', 'monetization',
                        'sons isentos de direitos', 'sound library', 'sound-library', 'sound_library', 'biblioteca de sons', 'sons', 'audio library', 'commercial music',
                        'smart split', 'smartsplit',
                        // TikTok Studio - Outros
                        'feedback',
                        // TikTok Studio - Topo e Abas
                        'editar perfil', 'edit profile',
                        'favoritos', 'favorites',
                        // TikTok Studio - Dashboard: Est. de recompensas e Métricas de Receita
                        'est. de recompensas', 'recompensas estimadas', 'recompensa estimada', 'estimated rewards',
                        'análises das recompensas', 'análise das recompensas', 'reward analytics', 'revenue analytics',
                        'origens das recompensas', 'reward sources',
                        'programas ativos', 'active programs',
                        'programas para ti', 'programas para você', 'programs for you',
                        'subscrição', 'subscription',
                        'presentes de vídeo', 'video gifts',
                        'inelegível', 'ineligible',
                        'aderir', 'join',
                        'aplicar', 'apply',
                        '$0.00', '$0,00', '0.00 €', '0,00 €',
                        'receita', 'receitas', 'revenue',
                        'receita estimada', 'estimated revenue',
                        // YouTube Studio
                        'definições', 'definicoes', 'definição', 'definicao',
                        'configurações', 'configuracoes', 'configuração', 'configuracao',
                        'settings', 'setting',
                        'mudar de conta', 'trocar de conta', 'alternar conta', 'switch account',
                        'adicionar conta', 'add account',
                        'terminar sessão', 'terminar sessao', 'sair', 'sign out', 'logout',
                        'gerir a sua conta google', 'gerir a sua conta do google', 'gerir conta google',
                        'gerenciar sua conta do google', 'gerenciar sua conta google', 'manage your google account',
                        'ganhar', 'earn',
                        'promover canal', 'promotions', 'promoções', 'promocoes',
                        'personalização', 'personalizacao', 'customization',
                        'biblioteca de áudio', 'audio library', 'creator music',
                        'enviar feedback', 'send feedback',
                        'copyright', 'direitos de autor', 'direitos autorais',
                        'ask studio',
                        'notificações', 'notificacoes', 'notifications',
                        'ajuda', 'help',
                        // Facebook Perfil Profissional
                        'ganhos', 'earnings',
                        'desativar modo profissional', 'turn off professional mode',
                        'estrelas', 'stars',
                        'anúncios nos reels', 'ads on reels',
                        'bônus', 'bonus',
                        'contas de pagamento', 'payouts',
                        'cobrança', 'cobranca', 'billing',
                        'gerenciador de anúncios', 'ads manager',
                        'turbinar publicação', 'turbinar publicacao', 'turbinar reel', 'boost post',
                        'turbinar', 'boost',
                        'central de contas', 'meta accounts center',
                        'amigos', 'friends',
                        'grupos', 'groups',
                        'marketplace', 'jogos', 'gaming',
                        // TikTok Studio - Dashboard: Conhecimento para ti / Promote
                        'conhecimento para ti', 'conhecimento para você', 'knowledge for you',
                        'accelerating your growth with promote',
                        'getting creative with color in your content',
                        'introducing creation inspirations'
                      ];

                      var BLOCKED_SECTION_TITLES = [
                        'definições', 'definicoes', 'configurações', 'configuracoes', 'settings',
                        'ferramentas', 'tools',
                        'crescimento', 'growth',
                        'outros', 'others',
                        'conhecimento para ti', 'conhecimento para você', 'knowledge for you',
                        'inspiração', 'inspiracao', 'inspiration',
                        'origens das recompensas', 'reward sources',
                        'programas ativos', 'active programs',
                        'programas para ti', 'programas para você', 'programs for you',
                        'ganhar', 'earn',
                        'contas de pagamento', 'payouts',
                        'gerenciador de anúncios', 'ads manager'
                      ];

                      var SAFE_URL_STUDIO = 'https://studio.tiktok.com/';
                      var SAFE_URL_WEB = 'https://www.tiktok.com/foryou';

                      function isBlockedUrl(rawUrl) {
                        if (!rawUrl) return false;
                        var url = rawUrl.toLowerCase();

                        // Exceção absoluta: URLs de upload de vídeo/foto são sempre permitidas (tab=video, tab=photo, tab=image, etc.)
                        var isUploadUrl = (
                          url.includes('/upload') ||
                          url.includes('/creator#/upload') ||
                          url.includes('/tiktokstudio/upload') ||
                          url.includes('/videos/upload') ||
                          url.includes('/composer') ||
                          url.includes('/reels_composer')
                        );
                        if (isUploadUrl) return false;

                        // 1. Regras TikTok Studio (tanto em studio.tiktok.com quanto em www.tiktok.com/tiktokstudio)
                        var isStudio = url.includes('studio.tiktok.com') || url.includes('/tiktokstudio');
                        if (isStudio) {
                          // Whitelist Estrita Permitida:
                          // Início: studio.tiktok.com/ ou tiktok.com/tiktokstudio/
                          // Publicações: /content ou /manage
                          // Análise: /analytics
                          // Comentários: /comments
                          var isStudioAllowed = (
                            url.startsWith('https://studio.tiktok.com') ||
                            url.startsWith('https://www.tiktok.com/tiktokstudio') ||
                            url.startsWith('https://tiktok.com/tiktokstudio') ||
                            url.includes('/upload') ||
                            url.includes('/content') ||
                            url.includes('/manage') ||
                            url.includes('/analytics') ||
                            url.includes('/comments') ||
                            url.includes('/home') ||
                            url.includes('/overview')
                          );
                          if (isStudioAllowed) return false;

                          // Se tentar abrir qualquer domínio externo (ex: suporte, ajuda, termos, etc.)
                          var isExternalSite = !url.includes('tiktok.com') && !url.includes('youtube.com') && !url.includes('google.com') && !url.includes('facebook.com') && !url.includes('fb.com');
                          if (isExternalSite && (url.startsWith('http://') || url.startsWith('https://'))) return true;

                          // Qualquer outra rota do Studio é estritamente bloqueada:
                          // /inspiration, /monetization, /sound-library, /tool/smartsplit, /tool/*, /academy, /feedback, etc.
                          return true;
                        }

                        // 2. Regras TikTok Web
                        if (url.includes('tiktok.com')) {
                          // Se o usuário está em sessão do Studio e tenta sair para o TikTok Web (ex: "Voltar ao TikTok")
                          var curPage = (window.location.href || '').toLowerCase();
                          var isCurStudio = curPage.includes('studio.tiktok.com') || curPage.includes('/tiktokstudio');
                          if (isCurStudio && !url.includes('/tiktokstudio') && !url.includes('/upload')) {
                            return true;
                          }

                          // Não bloquear rotas de autenticação/login/2fa
                          var isAuth = (
                            url.includes('/login') ||
                            url.includes('/signup') ||
                            url.includes('/passport') ||
                            url.includes('/auth') ||
                            url.includes('/verify') ||
                            url.includes('/challenge') ||
                            url.includes('/checkpoint')
                          );
                          if (isAuth) return false;

                          var isWebBlocked = (
                            url.includes('/@') ||
                            url.includes('/setting') ||
                            url.includes('/privacy') ||
                            url.includes('/language') ||
                            url.includes('/region') ||
                            url.includes('/promote') ||
                            url.includes('/live') ||
                            url.includes('/livestudio') ||
                            url.includes('/coin') ||
                            url.includes('/shop') ||
                            url.includes('/seller') ||
                            url.includes('/support') ||
                            url.includes('/help') ||
                            url.includes('/logout') ||
                            url.includes('/signout') ||
                            url.includes('/exit') ||
                            url.includes('/feedback') ||
                            url.includes('/monetization') ||
                            url.includes('/creator-monetization') ||
                            url.includes('/inspiration') ||
                            url.includes('/sound-library') ||
                            url.includes('/smartsplit') ||
                            url.includes('/smart-split')
                          );
                          if (isWebBlocked) return true;
                        }

                        // 3. Regras YouTube Studio
                        if (url.includes('studio.youtube.com')) {
                          var isYtStudioBlocked = (
                            url.includes('/settings') ||
                            url.includes('/permissions') ||
                            url.includes('/monetization') ||
                            url.includes('/earn') ||
                            url.includes('/revenue') ||
                            url.includes('/tab-revenue') ||
                            url.includes('/copyright') ||
                            url.includes('/audio') ||
                            url.includes('/music') ||
                            url.includes('/creator_music') ||
                            url.includes('/audiolibrary') ||
                            url.includes('/promotions') ||
                            url.includes('/branding') ||
                            url.includes('/basic') ||
                            url.includes('/profile') ||
                            url.includes('/memberships') ||
                            url.includes('/feedback') ||
                            (url.includes('/editing') && !url.includes('/edit'))
                          );
                          if (isYtStudioBlocked) return true;
                          return false;
                        }

                        // Se estiver no YouTube fora do Studio ou tentar acessar Google Account
                        if (url.includes('youtube.com') || url.includes('google.com')) {
                          var isConn = false;
                          try { isConn = checkIsConnected(); } catch(e) {}

                          // Rotas de autenticação/login do Google NUNCA devem ser bloqueadas
                          var isGoogleAuthUrl = (
                            url.includes('accounts.google.com') ||
                            url.includes('accounts.youtube.com') ||
                            url.includes('/signin') ||
                            url.includes('/servicelogin') ||
                            url.includes('/identifier') ||
                            url.includes('/challenge') ||
                            url.includes('/v2/') ||
                            url.includes('/v3/') ||
                            url.includes('/checkcookie') ||
                            url.includes('/setsid')
                          );
                          if (isGoogleAuthUrl && !url.includes('myaccount.google.com') && !url.includes('accountchooser') && !url.includes('addsession')) {
                            return false;
                          }

                          // Se o usuário JÁ estiver conectado:
                          // Bloquear terminantemente qualquer tentativa de acessar myaccount.google.com, troca de contas, logout, etc.
                          if (isConn) {
                            if (
                              url.includes('myaccount.google.com') ||
                              url.includes('accounts.google.com/accountchooser') ||
                              url.includes('accounts.google.com/addsession') ||
                              url.includes('accounts.google.com/b/') ||
                              url.includes('youtube.com/account') ||
                              url.includes('youtube.com/channel_switcher') ||
                              url.includes('support.google.com') ||
                              url.includes('/logout') ||
                              url.includes('/signout') ||
                              url.includes('/settings') ||
                              url.includes('/password') ||
                              (url.includes('youtube.com') && !url.includes('studio.youtube.com') && !isGoogleAuthUrl)
                            ) {
                              return true;
                            }
                          }

                          var curPageYt = (window.location.href || '').toLowerCase();
                          if (curPageYt.includes('studio.youtube.com')) {
                            if (!url.includes('studio.youtube.com')) {
                              return true;
                            }
                          }
                          if (url.includes('myaccount.google.com') || url.includes('/monetization') || url.includes('/earn') || url.includes('/settings') || url.includes('/password') || url.includes('support.google.com')) {
                            return true;
                          }
                        }

                        // 4. Regras Facebook (Páginas e Publicação de Reels)
                        if (url.includes('facebook.com')) {
                          var isFbAuth = (
                            url.includes('/login') ||
                            url.includes('/r.php') ||
                            url.includes('/reg') ||
                            url.includes('/signup') ||
                            url.includes('/checkpoint') ||
                            url.includes('/recover') ||
                            url.includes('/auth') ||
                            url.includes('/two_step_verification') ||
                            url.includes('/confirmemail') ||
                            url.includes('/identity') ||
                            url.includes('m.facebook.com') ||
                            url.includes('/cookie') ||
                            url.includes('/help') ||
                            url.includes('facebook.com/ajax') ||
                            url.includes('facebook.com/api')
                          );
                          if (isFbAuth) return false;

                          // Verificar se o usuário está autenticado no Facebook
                          var isLoggedIntoFb = false;
                          try { isLoggedIntoFb = checkIsConnected(); } catch(e) {}
                          if (!isLoggedIntoFb) {
                            // Não autenticado: permitir telas de login e cadastro (/r.php) sem erros
                            return false;
                          }

                          var isFbBlocked = (
                            url.includes('/monetization') ||
                            url.includes('/payouts') ||
                            url.includes('/billing') ||
                            url.includes('/insights/earnings') ||
                            url.includes('/ads') ||
                            url.includes('/ad_center') ||
                            url.includes('adsmanager') ||
                            url.includes('accountscenter.facebook.com') ||
                            url.includes('/settings') ||
                            url.includes('/security') ||
                            url.includes('/privacy') ||
                            url.includes('/friends') ||
                            url.includes('/groups') ||
                            url.includes('/marketplace') ||
                            url.includes('/gaming') ||
                            url.includes('/watch') ||
                            url.includes('/logout') ||
                            url.includes('turn_off_professional_mode')
                          );
                          if (isFbBlocked) return true;

                          // Permitir a Página Atribuída fornecida pelo ADM
                          var assignedPage = (window.__AGENT_PAGE_URL__ || '').toLowerCase().trim();
                          if (assignedPage) {
                            var cleanAssigned = assignedPage.replace('https://www.facebook.com', '').replace('https://facebook.com', '');
                            if (url.startsWith(assignedPage) || (cleanAssigned.length > 2 && url.includes(cleanAssigned))) {
                              return false;
                            }
                          }

                          // Permitir criação e gestão de Páginas e publicação de Reels/vídeos
                          var isFbAllowed = (
                            url.includes('/pages') ||
                            url.includes('/pages/create') ||
                            url.includes('/professional_dashboard') ||
                            url.includes('/composer') ||
                            url.includes('/reels/create') ||
                            url.includes('/media/set') ||
                            url.includes('/photo') ||
                            url.includes('/reel') ||
                            url.includes('/stories') ||
                            url.includes('/upload')
                          );
                          if (isFbAllowed) return false;

                          if (url === 'https://www.facebook.com' || url === 'https://www.facebook.com/' || url.startsWith('https://www.facebook.com/?') || url.includes('/home.php') || url.includes('/me') || url.includes('/notifications') || url.includes('/messages')) {
                            return true;
                          }

                          // Se houver página atribuída, qualquer navegação para outra página pessoal/externa é bloqueada
                          if (assignedPage) {
                            return true;
                          }
                        }

                        return false;
                      }

                      var __isRedirecting__ = false;
                      function redirectToSafe(attemptedUrl) {
                        if (__isRedirecting__) return;

                        var currentUrl = (attemptedUrl || window.location.href || '').toLowerCase();
                        var targetSafe = 'https://studio.tiktok.com/';
                        if (currentUrl.includes('tiktok.com/tiktokstudio') || window.location.href.includes('tiktok.com/tiktokstudio')) {
                          targetSafe = 'https://www.tiktok.com/tiktokstudio/';
                        } else if (currentUrl.includes('youtube.com') || currentUrl.includes('google.com') || window.location.href.includes('studio.youtube.com')) {
                          targetSafe = (window.__AGENT_PAGE_URL__ && window.__AGENT_PAGE_URL__.trim()) ? window.__AGENT_PAGE_URL__.trim() : 'https://studio.youtube.com/';
                        } else if (currentUrl.includes('facebook.com') || window.location.href.includes('facebook.com')) {
                          var isFbConn = false;
                          try { isFbConn = checkIsConnected(); } catch(e) {}
                          targetSafe = isFbConn
                            ? (window.__AGENT_PAGE_URL__ || 'https://www.facebook.com/pages/')
                            : 'https://www.facebook.com/login';
                        } else if (currentUrl.includes('tiktok.com') && !currentUrl.includes('studio')) {
                          targetSafe = SAFE_URL_WEB;
                        }

                        // Notificar processo Electron para registrar auditoria de segurança no Supabase
                        try {
                          console.log('[AGENT_BLOCKED_ATTEMPT]:' + JSON.stringify({
                            url: attemptedUrl || window.location.href,
                            redirectedTo: targetSafe,
                            timestamp: new Date().toISOString()
                          }));
                        } catch(e) {}

                        showBlockedToast();

                        var cleanCurrent = window.location.href.split('?')[0].split('#')[0];
                        if (cleanCurrent.endsWith('/')) cleanCurrent = cleanCurrent.slice(0, -1);
                        var cleanTarget = targetSafe.split('?')[0].split('#')[0];
                        if (cleanTarget.endsWith('/')) cleanTarget = cleanTarget.slice(0, -1);

                        if (cleanCurrent !== cleanTarget) {
                          __isRedirecting__ = true;
                          try {
                            window.stop();
                          } catch(e) {}
                          window.location.replace(targetSafe);
                          setTimeout(function() { __isRedirecting__ = false; }, 2000);
                        }
                      }

                      function showBlockedToast() {
                        var oldToast = document.getElementById('agent-blocked-toast');
                        if (oldToast) oldToast.remove();

                        var toast = document.createElement('div');
                        toast.id = 'agent-blocked-toast';
                        toast.style.cssText = 'position:fixed; top:24px; left:50%; transform:translateX(-50%); background:linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color:#ffffff; padding:12px 28px; border-radius:14px; z-index:2147483647; font-family:system-ui,-apple-system,sans-serif; font-size:14px; font-weight:800; box-shadow:0 12px 35px rgba(0,0,0,0.6); border:2px solid #ef4444; pointer-events:none; transition:opacity 0.3s ease; letter-spacing:0.3px;';
                        toast.textContent = '🔒 Área restrita — redirecionando automaticamente...';
                        (document.body || document.documentElement).appendChild(toast);
                        setTimeout(function() {
                          toast.style.opacity = '0';
                          setTimeout(function() { toast.remove(); }, 300);
                        }, 2200);
                      }

                      function applyPostLoginSecurity() {
                        // Se o usuário ainda não estiver conectado/autenticado, NUNCA aplicar regras pós-login
                        if (typeof checkIsConnected === 'function' && !checkIsConnected()) {
                          return;
                        }

                        // Se a página atual já estiver em URL restrita, redirecionar IMEDIATAMENTE
                        if (isBlockedUrl(window.location.href)) {
                          redirectToSafe(window.location.href);
                          return;
                        }

                        // 1. Injetar CSS de Bloqueio Estrito no <head> (Executa instantaneamente no motor do Chrome)
                        if (!document.getElementById('agent-post-login-css')) {
                          var style = document.createElement('style');
                          style.id = 'agent-post-login-css';
                          style.textContent = POST_LOGIN_CSS;
                          (document.head || document.documentElement).appendChild(style);
                        }

                        function isProtectedElement(node) {
                          if (!node || node === document.body || node === document.documentElement || node.id === 'root') return true;
                          var role = (node.getAttribute && node.getAttribute('role') || '').toLowerCase();
                          var pagelet = (node.getAttribute && node.getAttribute('data-pagelet') || '').toLowerCase();
                          if (
                            role === 'main' || pagelet === 'rightrail' || pagelet.includes('feed') ||
                            pagelet.includes('timeline') || pagelet.includes('profile') || pagelet.includes('main')
                          ) return true;
                          var cls = (node.className || '').toString().toLowerCase();
                          var id = (node.id || '').toLowerCase();
                          if (
                            cls.includes('upload') || cls.includes('stage') || cls.includes('editor') ||
                            cls.includes('form') || cls.includes('layout-main') || cls.includes('main-content') ||
                            cls.includes('container-right') || cls.includes('main-right') || cls.includes('layout-right') ||
                            cls.includes('footer') || cls.includes('btn') || cls.includes('button') ||
                            cls.includes('publish') || cls.includes('post')
                          ) return true;
                          if (id.includes('upload') || id.includes('stage') || id.includes('editor') || id.includes('footer') || id === 'root') return true;
                          return false;
                        }

                        // 2. Varredura com suporte recursivo a Shadow DOM para ocultar menus dinâmicos e detectar telas restritas
                        try {
                          function queryAllWithShadow(selector, rootNode) {
                            var root = rootNode || document;
                            var list = [];
                            try { list = Array.from(root.querySelectorAll(selector)); } catch(eQ) {}
                            try {
                              var allNodes = root.querySelectorAll('*');
                              for (var idx = 0; idx < allNodes.length; idx++) {
                                var sRoot = allNodes[idx].shadowRoot;
                                if (sRoot) {
                                  if (!sRoot.getElementById('agent-shadow-css')) {
                                    try {
                                      var sStyle = document.createElement('style');
                                      sStyle.id = 'agent-shadow-css';
                                      sStyle.textContent = SHADOW_CSS;
                                      sRoot.appendChild(sStyle);
                                    } catch(eStyl) {}
                                  }
                                  list = list.concat(queryAllWithShadow(selector, sRoot));
                                }
                              }
                            } catch(eS) {}
                            return list;
                          }

                          // A. Neutralizar todos os atributos target="_blank" no DOM para impedir abertura de janelas externas
                          var blankLinks = queryAllWithShadow('a[target="_blank"], a[target="_new"], a[target="blank"]');
                          for (var bIdx = 0; bIdx < blankLinks.length; bIdx++) {
                            blankLinks[bIdx].removeAttribute('target');
                            blankLinks[bIdx].setAttribute('target', '_self');
                          }

                          // B. Varredura específica de links <a> por HREF (incluindo dentro de Shadow Roots)
                          var allAnchors = queryAllWithShadow('a');
                          for (var aIdx = 0; aIdx < allAnchors.length; aIdx++) {
                            var aTag = allAnchors[aIdx];
                            var aHref = (aTag.getAttribute('href') || aTag.href || '').toLowerCase();
                            if (!aHref) continue;

                            var isRestrictedHref = (
                              aHref.includes('inspiration') ||
                              aHref.includes('monetization') ||
                              aHref.includes('/earn') ||
                              aHref.includes('/copyright') ||
                              aHref.includes('/audio') ||
                              aHref.includes('/editing') ||
                              aHref.includes('/promotions') ||
                              aHref.includes('/music') ||
                              aHref.includes('sound-library') ||
                              aHref.includes('sound_library') ||
                              aHref.includes('smartsplit') ||
                              aHref.includes('smart-split') ||
                              aHref.includes('creator-academy') ||
                              aHref.includes('/academy') ||
                              aHref.includes('feedback') ||
                              aHref.includes('/payouts') ||
                              aHref.includes('/billing') ||
                              aHref.includes('/ads') ||
                              aHref.includes('adsmanager') ||
                              aHref.includes('accountscenter.facebook.com') ||
                              aHref.includes('turn_off_professional_mode') ||
                              aHref.includes('support.google.com') ||
                              (aHref.includes('tiktok.com') && !aHref.includes('tiktokstudio') && !aHref.includes('upload') && (window.location.href.includes('tiktokstudio') || window.location.href.includes('studio.tiktok.com')))
                            );

                            if (isRestrictedHref) {
                              var aBox = aTag.closest('ytcp-navigation-item, li, div[class*="item"], div[class*="Item"], div[class*="menu"], div[class*="nav"], div[class*="side"]') || aTag;
                              if (isProtectedElement(aBox)) continue;
                              aBox.style.setProperty('display', 'none', 'important');
                              aBox.style.setProperty('visibility', 'hidden', 'important');
                              aBox.style.setProperty('pointer-events', 'none', 'important');
                              aBox.style.setProperty('opacity', '0', 'important');
                              aBox.setAttribute('data-blocked-by-agent', 'true');
                              aTag.setAttribute('data-blocked-by-agent', 'true');
                            }
                          }

                          // C. Varredura de elementos de navegação (YouTube Web Components, TikTok, Facebook)
                          var allItems = queryAllWithShadow('ytcp-navigation-item, tp-yt-paper-icon-item, ytd-topbar-menu-button-renderer, ytcp-button, ytcp-icon-button, button, tp-yt-paper-tab, #avatar-btn, #settings-item, #settings-button, [test-id="SETTINGS"], [id="avatar-btn"], [id="avatar"], nav a, ytcp-navigation-drawer a, .sidebar a, [role="navigation"] a, [role="tab"], [data-e2e*="menu"], [data-e2e*="item"]');
                          for (var i = 0; i < allItems.length; i++) {
                            var el = allItems[i];
                            if (el.children.length > 10) continue;

                            var elId = (el.id || '').toLowerCase();
                            var elTag = (el.tagName || '').toUpperCase();
                            var testId = (el.getAttribute('test-id') || el.getAttribute('data-testid') || el.getAttribute('data-e2e') || '').toUpperCase();
                            var elAria = (el.getAttribute('aria-label') || '').toLowerCase();
                            var elHref = (el.getAttribute('href') || el.href || '').toLowerCase();

                            if (
                              elId === 'settings-item' ||
                              elId === 'avatar-btn' ||
                              elId === 'avatar' ||
                              elTag === 'YTD-TOPBAR-MENU-BUTTON-RENDERER' ||
                              elId === 'settings-button' ||
                              elId === 'feedback-button' ||
                              elId === 'notification-button' ||
                              testId === 'SETTINGS' ||
                              testId === 'COPYRIGHT' ||
                              testId === 'MONETIZATION' ||
                              testId === 'CUSTOMIZATION' ||
                              testId === 'PROMOTIONS' ||
                              testId === 'CREATOR_MUSIC' ||
                              testId === 'AUDIO_LIBRARY' ||
                              testId === 'AUDIOLIBRARY' ||
                              testId === 'SEND_FEEDBACK' ||
                              testId === 'FEEDBACK' ||
                              testId === 'REVENUE' ||
                              testId === 'ESTIMATED-REVENUE-CARD' ||
                              testId.includes('REWARD') ||
                              testId.includes('SMARTSPLIT') ||
                              elAria.includes('definições') ||
                              elAria.includes('definicoes') ||
                              elAria.includes('configurações') ||
                              elAria.includes('configuracoes') ||
                              elAria.includes('settings') ||
                              elAria === 'account' ||
                              elAria.includes('google account') ||
                              elAria.includes('conta do google') ||
                              elAria.includes('gerir a sua conta') ||
                              elAria.includes('gerenciar sua conta') ||
                              elAria.includes('sua foto do perfil') ||
                              elAria.includes('your profile') ||
                              elAria.includes('a tua foto do perfil') ||
                              elAria.includes('copyright') ||
                              elAria.includes('direitos de autor') ||
                              elAria.includes('direitos autorais') ||
                              elAria.includes('ask studio') ||
                              ((elAria.includes('notification') || elAria.includes('notificaç') || elAria.includes('notificac')) && (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('google.com'))) ||
                              ((elAria.includes('help') || elAria.includes('ajuda')) && (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('google.com'))) ||
                                                            elHref.includes('/settings') ||
                              elHref.includes('/permissions') ||
                              elHref.includes('/monetization') ||
                              elHref.includes('/copyright') ||
                              elHref.includes('/audio') ||
                              elHref.includes('/creator_music') ||
                              elHref.includes('/audiolibrary') ||
                              elHref.includes('/branding') ||
                              elHref.includes('/memberships') ||
                              elHref.includes('/feedback') ||
                              elHref.includes('support.google.com')
                            ) {
                              el.style.setProperty('display', 'none', 'important');
                              el.style.setProperty('visibility', 'hidden', 'important');
                              el.style.setProperty('pointer-events', 'none', 'important');
                              el.style.setProperty('opacity', '0', 'important');
                              el.setAttribute('data-blocked-by-agent', 'true');

                              var navParent = el.closest('ytcp-navigation-item');
                              if (navParent) {
                                navParent.style.setProperty('display', 'none', 'important');
                                navParent.style.setProperty('visibility', 'hidden', 'important');
                                navParent.style.setProperty('pointer-events', 'none', 'important');
                                navParent.style.setProperty('opacity', '0', 'important');
                                navParent.setAttribute('data-blocked-by-agent', 'true');
                              }
                              var iconItemParent = el.closest('tp-yt-paper-icon-item');
                              if (iconItemParent) {
                                iconItemParent.style.setProperty('display', 'none', 'important');
                                iconItemParent.style.setProperty('visibility', 'hidden', 'important');
                                iconItemParent.style.setProperty('pointer-events', 'none', 'important');
                                iconItemParent.style.setProperty('opacity', '0', 'important');
                                iconItemParent.setAttribute('data-blocked-by-agent', 'true');
                              }
                              var topbarParent = el.closest('ytd-topbar-menu-button-renderer');
                              if (topbarParent) {
                                topbarParent.style.setProperty('display', 'none', 'important');
                                topbarParent.style.setProperty('visibility', 'hidden', 'important');
                                topbarParent.style.setProperty('pointer-events', 'none', 'important');
                                topbarParent.style.setProperty('opacity', '0', 'important');
                                topbarParent.setAttribute('data-blocked-by-agent', 'true');
                              }
                              continue;
                            }

                            var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (!txt || txt.length > 75) continue;

                            // NUNCA ocultar itens permitidos da whitelist
                            var isYtStudio = window.location.hostname.includes('studio.youtube.com');
                            if (
                              txt === 'início' || txt === 'inicio' || txt === 'home' ||
                              txt === 'painel' || txt === 'dashboard' || txt === 'painel profissional' || txt === 'professional dashboard' ||
                              txt === 'publicações' || txt === 'publicacoes' || txt === 'content' || txt === 'posts' || txt === 'reels' || txt === 'vídeos' || txt === 'videos' ||
                              txt === 'análise' || txt === 'analise' || txt === 'analytics' || txt === 'insights' || txt === 'métricas' || txt === 'metricas' ||
                              txt === 'comentários' || txt === 'comentarios' || txt === 'comments' ||
                              txt === 'legendas' || txt === 'subtitles' ||
                              (!isYtStudio && (txt === 'carregar' || txt === 'upload' || txt.includes('carregar') || txt.includes('upload'))) ||
                              (!isYtStudio && (txt === 'criar' || txt === 'create' || txt === 'criar publicação' || txt === 'criar publicacao' || txt === 'criar reel')) ||
                              txt === 'publicações recentes' || txt === 'publicacoes recentes' ||
                              txt === 'comentários mais recentes' || txt === 'comentarios mais recentes' ||
                              txt === 'visualizações de vídeo' || txt === 'visualizações de perfil' || txt === 'gostos' || txt === 'partilhas' ||
                              txt === 'alcance' || txt === 'interações' || txt === 'seguidores'
                            ) {
                              continue;
                            }

                            // Ocultar itens específicos por palavra-chave
                            for (var k = 0; k < BLOCKED_TEXT_KEYWORDS.length; k++) {
                              var kw = BLOCKED_TEXT_KEYWORDS[k];
                              if (txt === kw || (txt.startsWith(kw) && txt.length < kw.length + 10) || (kw.length > 6 && txt.includes(kw))) {
                                var targetBox = el.closest('ytcp-navigation-item, a, button, div[role="button"], li, div[class*="item"], div[class*="Item"], div[class*="card"], div[class*="Card"], div[class*="box"], div[class*="Box"], div[class*="col"], div[class*="Col"], div[class*="side"], div[class*="menu"]') || el;
                                if (isProtectedElement(targetBox)) continue;
                                targetBox.style.setProperty('display', 'none', 'important');
                                targetBox.style.setProperty('visibility', 'hidden', 'important');
                                targetBox.style.setProperty('pointer-events', 'none', 'important');
                                targetBox.style.setProperty('opacity', '0', 'important');
                                targetBox.setAttribute('data-blocked-by-agent', 'true');
                                break;
                              }
                            }

                            // Ocultar seções inteiras (NUNCA incluir div container para não afetar layout root)
                            for (var s = 0; s < BLOCKED_SECTION_TITLES.length; s++) {
                              var secTitle = BLOCKED_SECTION_TITLES[s];
                              if (txt === secTitle || txt.startsWith(secTitle + ' >') || txt.startsWith(secTitle + ' ›')) {
                                var secBox = el.closest('div[class*="section"], div[class*="group"], div[class*="card"], div[class*="aside"], section') || el;
                                if (isProtectedElement(secBox)) continue;
                                secBox.style.setProperty('display', 'none', 'important');
                                secBox.style.setProperty('visibility', 'hidden', 'important');
                                secBox.style.setProperty('pointer-events', 'none', 'important');
                                secBox.style.setProperty('opacity', '0', 'important');
                                secBox.setAttribute('data-blocked-by-agent', 'true');
                                break;
                              }
                            }
                          }

                          // D. Fechar e ocultar imediatamente qualquer diálogo de Definições ou dropdown de Conta
                          var dialogsAndPopups = queryAllWithShadow('ytcp-dialog, ytcp-settings-dialog, tp-yt-paper-dialog, tp-yt-iron-dropdown, iron-dropdown, ytd-multi-page-menu-renderer, ytcp-popup-container');
                          for (var d = 0; d < dialogsAndPopups.length; d++) {
                            var dNode = dialogsAndPopups[d];
                            // Exceção absoluta: NUNCA fechar ou ocultar o diálogo de upload de vídeos
                            if (dNode.tagName === 'YTCP-UPLOADS-DIALOG' || (dNode.closest && dNode.closest('ytcp-uploads-dialog')) || (dNode.id || '').includes('upload')) continue;
                            var dId = (dNode.id || '').toLowerCase();
                            var dTitle = (dNode.getAttribute('dialog-title') || dNode.getAttribute('title') || '').toLowerCase();
                            var dText = (dNode.innerText || dNode.textContent || '').toLowerCase();

                            if (
                              dId === 'settings-dialog' ||
                              dNode.tagName === 'YTCP-SETTINGS-DIALOG' ||
                              dTitle.includes('definições') || dTitle.includes('definicoes') ||
                              dTitle.includes('configurações') || dTitle.includes('configuracoes') ||
                              dTitle.includes('settings') ||
                              dText.includes('mudar de conta') || dText.includes('trocar de conta') ||
                              dText.includes('alternar conta') || dText.includes('switch account') ||
                              dText.includes('gerir a sua conta google') || dText.includes('gerenciar sua conta do google') ||
                              dText.includes('terminar sessão') || dText.includes('sign out') ||
                              dText.includes('padrões de envio') || (dText.includes('permissões') && dText.includes('comunidade'))
                            ) {
                              dNode.style.setProperty('display', 'none', 'important');
                              dNode.style.setProperty('visibility', 'hidden', 'important');
                              dNode.style.setProperty('pointer-events', 'none', 'important');
                              dNode.style.setProperty('opacity', '0', 'important');
                              dNode.setAttribute('data-blocked-by-agent', 'true');
                              try {
                                if (typeof dNode.close === 'function') dNode.close();
                                if (typeof dNode.cancel === 'function') dNode.cancel();
                              } catch(_) {}
                            }
                          }
                        } catch(eScan) {}

                        // 3. Interceptação de Navegação SPA (history.pushState / history.replaceState / popstate)
                        if (!window.__AGENT_HISTORY_PATCHED__) {
                          window.__AGENT_HISTORY_PATCHED__ = true;
                          var origPushState = history.pushState;
                          var origReplaceState = history.replaceState;

                          history.pushState = function(state, unused, url) {
                            if (url && checkIsConnected()) {
                              var resolvedUrl = '';
                              try {
                                resolvedUrl = new URL(url, window.location.href).href;
                              } catch(_) {
                                resolvedUrl = String(url);
                              }
                              if (isBlockedUrl(resolvedUrl)) {
                                redirectToSafe(resolvedUrl);
                                return;
                              }
                            }
                            return origPushState.apply(this, arguments);
                          };

                          history.replaceState = function(state, unused, url) {
                            if (url && checkIsConnected()) {
                              var resolvedUrl = '';
                              try {
                                resolvedUrl = new URL(url, window.location.href).href;
                              } catch(_) {
                                resolvedUrl = String(url);
                              }
                              if (isBlockedUrl(resolvedUrl)) {
                                redirectToSafe(resolvedUrl);
                                return;
                              }
                            }
                            return origReplaceState.apply(this, arguments);
                          };

                          window.addEventListener('popstate', function() {
                            if (checkIsConnected() && isBlockedUrl(window.location.href)) {
                              redirectToSafe(window.location.href);
                            }
                          });
                        }

                        // 4. Bloqueio de Teclas de Atalho (DevTools / F12 / Inspecionar) & Botão Direito & Cliques
                        if (!window.__AGENT_KEY_LISTENER_ACTIVE__) {
                          window.__AGENT_KEY_LISTENER_ACTIVE__ = true;

                          document.addEventListener('keydown', function(e) {
                            if (!checkIsConnected()) return;

                            // F12
                            if (e.key === 'F12') {
                              e.preventDefault(); e.stopPropagation(); return false;
                            }
                            // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
                            if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
                              e.preventDefault(); e.stopPropagation(); return false;
                            }
                            // Ctrl+U (Ver código-fonte)
                            if (e.ctrlKey && ['U', 'u'].includes(e.key)) {
                              e.preventDefault(); e.stopPropagation(); return false;
                            }
                          }, true);

                          // Bloquear botão direito (Context menu / Inspecionar)
                          document.addEventListener('contextmenu', function(e) {
                            if (checkIsConnected()) {
                              e.preventDefault();
                              return false;
                            }
                          }, true);

                          // Interceptar cliques, pointerdown e mousedown preventivamente com CANCELAMENTO IMEDIATO
                          function handleSecurityInterception(e) {
                            var path = (e.composedPath && e.composedPath()) || [];
                            var target = e.target;
                            if (!target && path.length === 0) return;

                            // 0. EXCEÇÃO PRIORITÁRIA 1: Elementos da própria barra/ferramentas do Agente
                            for (var aIdx = 0; aIdx < path.length; aIdx++) {
                              var aNode = path[aIdx];
                              if (!aNode) continue;
                              var aId = (aNode.id || '').toLowerCase();
                              var aCls = (aNode.className || '').toString().toLowerCase();
                              if (
                                aId.startsWith('agent-') ||
                                aId.startsWith('btn-copy') ||
                                aId.startsWith('btn-close') ||
                                aCls.includes('agent-') ||
                                (aNode.getAttribute && aNode.getAttribute('data-agent-ui'))
                              ) {
                                return; // Permitido! Clique em botão do próprio agente
                              }
                            }
                            if (target && target.id && (target.id.startsWith('agent-') || target.id.startsWith('btn-copy') || target.id.startsWith('btn-close'))) return;

                            // 0. EXCEÇÃO PRIORITÁRIA 2: Se o usuário ainda não estiver conectado (cadastro / login / pre-auth)
                            try {
                              if (typeof checkIsConnected === 'function' && !checkIsConnected()) {
                                return; // Permitido! Não bloquear cliques durante o fluxo de cadastro ou login
                              }
                            } catch(_) {}

                            // 0. EXCEÇÃO ABSOLUTA: Upload, Publicar, Criar
                            var isUpload = false;
                            for (var upIdx = 0; upIdx < path.length; upIdx++) {
                              var upNode = path[upIdx];
                              if (!upNode || upNode === document || upNode === window) break;
                              if (upNode.tagName === 'INPUT' && (upNode.type === 'file' || (upNode.getAttribute && upNode.getAttribute('type') === 'file'))) {
                                isUpload = true; break;
                              }
                              var upE2e = (upNode.getAttribute && (upNode.getAttribute('data-e2e') || upNode.getAttribute('class') || '') || '').toLowerCase();
                              var upTxt = (upNode.innerText || upNode.textContent || '').trim().toLowerCase();
                              if (
                                upE2e.includes('upload') || upE2e.includes('publish') || upE2e.includes('postar') || upE2e.includes('stage') || upE2e.includes('editor') ||
                                upTxt.includes('publicar') || upTxt.includes('postar') || upTxt === 'post' || upTxt.startsWith('post ') || upTxt.includes('post now')
                              ) {
                                isUpload = true; break;
                              }
                            }
                            if (isUpload) return; // Permitido!

                            // 1. Inspecionar cada nó no caminho do evento (penetra Shadow DOM do YouTube e componentes do Facebook)
                            for (var pIdx = 0; pIdx < path.length; pIdx++) {
                              var pNode = path[pIdx];
                              if (!pNode || pNode === document || pNode === window) break;

                              // NUNCA verificar nós de alto nível ou containers com múltiplos filhos (evita falso positivo no body/html/root)
                              if (pNode === document.body || pNode === document.documentElement || pNode.id === 'root' || (pNode.children && pNode.children.length > 3)) {
                                continue;
                              }

                              // Whitelist prioritária: Upload / Criar vídeo no YouTube e Facebook NUNCA devem ser bloqueados
                              var checkId = (pNode.id || '').toLowerCase();
                              var checkTag = (pNode.tagName || '').toUpperCase();
                              var checkAria = (pNode.getAttribute && pNode.getAttribute('aria-label') || '').toLowerCase();
                              var checkTxt = (pNode.innerText || pNode.textContent || '').trim().toLowerCase();
                              if (
                                checkId === 'create-button' ||
                                checkId === 'create-icon' ||
                                checkId === 'upload-button' ||
                                checkId === 'select-files-button' ||
                                checkId === 'next-button' ||
                                checkId === 'done-button' ||
                                checkTag === 'YTCP-UPLOADS-DIALOG' ||
                                (pNode.closest && pNode.closest('ytcp-uploads-dialog')) ||
                                checkAria === 'create' ||
                                checkAria === 'criar' ||
                                checkAria.includes('carregar vídeos') ||
                                checkAria.includes('upload videos') ||
                                checkTxt.includes('carregar vídeos') ||
                                checkTxt.includes('upload videos') ||
                                checkTxt.includes('selecionar ficheiros') ||
                                checkTxt.includes('select files')
                              ) {
                                return; // Permitir clique livremente!
                              }

                              // Interceptar imediatamente qualquer tentativa de clicar em "Terminar sessão" ou Logout
                              var isLogoutCandidate = (
                                checkId.includes('logout') ||
                                checkId.includes('signout') ||
                                checkAria.includes('terminar sessão') ||
                                checkAria.includes('terminar sessao') ||
                                checkAria.includes('log out') ||
                                checkAria.includes('logout') ||
                                checkAria.includes('sign out') ||
                                checkAria === 'sair' ||
                                checkAria.startsWith('sair ') ||
                                checkAria.endsWith(' sair') ||
                                (checkTxt && (
                                  checkTxt === 'terminar sessão' ||
                                  checkTxt === 'terminar sessao' ||
                                  checkTxt === 'log out' ||
                                  checkTxt === 'logout' ||
                                  checkTxt === 'sign out' ||
                                  checkTxt === 'encerrar sessão' ||
                                  checkTxt === 'sair' ||
                                  checkTxt.startsWith('sair ') ||
                                  checkTxt.endsWith(' sair') ||
                                  ((checkTxt.includes('terminar sessão') || checkTxt.includes('terminar sessao')) && checkTxt.length < 35) ||
                                  ((checkTxt.includes('log out') || checkTxt.includes('sign out')) && checkTxt.length < 25)
                                ))
                              );
                              if (isLogoutCandidate) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                showBlockedToast();
                                return false;
                              }

                              // Elemento marcado pelo agente como bloqueado
                              if (pNode.getAttribute && pNode.getAttribute('data-blocked-by-agent') === 'true') {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                showBlockedToast();
                                return false;
                              }

                              var pId = (pNode.id || '').toLowerCase();
                              var pTag = (pNode.tagName || '').toUpperCase();
                              var pTestId = (pNode.getAttribute && (pNode.getAttribute('test-id') || pNode.getAttribute('data-testid') || pNode.getAttribute('data-e2e') || '') || '').toUpperCase();
                              var pAria = (pNode.getAttribute && pNode.getAttribute('aria-label') || '').toLowerCase();
                              var pHref = (pNode.getAttribute && pNode.getAttribute('href') || pNode.href || '').toLowerCase();
                              var pTxt = (pNode.innerText || pNode.textContent || '').trim().toLowerCase();

                              // YouTube Studio Web Components & Topbar Avatar & Definições
                              if (
                                pId === 'settings-item' ||
                                pId === 'avatar-btn' ||
                                pId === 'avatar' ||
                                pTag === 'YTD-TOPBAR-MENU-BUTTON-RENDERER' ||
                                pId === 'settings-button' ||
                                pId === 'feedback-button' ||
                                pId === 'notification-button' ||
                                pTestId === 'MONETIZATION' ||
                                pTestId === 'CUSTOMIZATION' ||
                                pTestId === 'PROMOTIONS' ||
                                pTestId === 'CREATOR_MUSIC' ||
                                pTestId === 'AUDIO_LIBRARY' ||
                                pTestId === 'AUDIOLIBRARY' ||
                                pTestId === 'COPYRIGHT' ||
                                pTestId === 'SETTINGS' ||
                                pTestId === 'SEND_FEEDBACK' ||
                                pTestId === 'FEEDBACK' ||
                                pTestId === 'REVENUE' ||
                                pTestId.includes('REWARD') ||
                                pTestId.includes('SMARTSPLIT') ||
                                pAria.includes('definições') ||
                                pAria.includes('definicoes') ||
                                pAria.includes('configurações') ||
                                pAria.includes('configuracoes') ||
                                pAria.includes('settings') ||
                                pAria === 'account' ||
                                pAria.includes('google account') ||
                                pAria.includes('conta do google') ||
                                pAria.includes('gerir a sua conta') ||
                                pAria.includes('gerenciar sua conta') ||
                                pAria.includes('mudar de conta') ||
                                pAria.includes('trocar de conta') ||
                                pAria.includes('alternar conta') ||
                                pAria.includes('switch account') ||
                                pAria.includes('sua foto do perfil') ||
                                pAria.includes('your profile') ||
                                pAria.includes('a tua foto do perfil') ||
                                pAria.includes('copyright') ||
                                pAria.includes('direitos de autor') ||
                                pAria.includes('direitos autorais') ||
                                pAria.includes('ask studio') ||
                                ((pAria.includes('notification') || pAria.includes('notificaç') || pAria.includes('notificac')) && (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('google.com'))) ||
                                ((pAria.includes('help') || pAria.includes('ajuda')) && (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('google.com'))) ||
                                (window.location.hostname.includes('facebook.com') && (
                                  pAria.includes('tua foto do perfil') ||
                                  pAria.includes('sua foto do perfil') ||
                                  pAria.includes('your profile') ||
                                  pAria === 'conta' ||
                                  pAria === 'account' ||
                                  pAria.includes('facebook') ||
                                  pAria.includes('menu do facebook') ||
                                  pAria.includes('controles da conta') ||
                                  pAria.includes('controlos da conta') ||
                                  pAria.includes('alternar') ||
                                  pAria.includes('switch') ||
                                  pAria.includes('troque para') ||
                                  pTxt === 'alternar' ||
                                  pTxt.startsWith('alternar ') ||
                                  pTxt.startsWith('trocar ') ||
                                  pTxt.includes('troque para a página') ||
                                  pTxt.includes('troque para a pagina') ||
                                  pHref === '/' || pHref === 'https://www.facebook.com/'
                                )) ||
                                pAria.includes('turbinar') ||
                                pAria.includes('boost') ||
                                pAria.includes('desativar modo profissional') ||
                                pAria.includes('turn off professional mode') ||
                                pAria.includes('receita estimada') ||
                                pAria.includes('estimated revenue') ||
                                (pTxt && (
                                  pTxt === 'definições' || pTxt === 'definicoes' ||
                                  pTxt === 'configurações' || pTxt === 'configuracoes' ||
                                  pTxt === 'settings' ||
                                  pTxt.includes('mudar de conta') || pTxt.includes('trocar de conta') ||
                                  (pTxt === 'terminar sessão' || pTxt === 'terminar sessao' || (pTxt.includes('terminar sessão') && pTxt.length < 30)) ||
                                  (pTxt === 'sair' || pTxt.startsWith('sair ') || pTxt.endsWith(' sair')) ||
                                  (pTxt === 'sign out' || pTxt.startsWith('sign out ') || pTxt.endsWith(' sign out')) ||
                                  (pTxt === 'log out' || pTxt.startsWith('log out ') || pTxt.endsWith(' log out')) ||
                                  (pTxt === 'logout' || pTxt.startsWith('logout ') || pTxt.endsWith(' logout')) ||
                                  pTxt.includes('gerir a sua conta google') ||
                                  pTxt.includes('gerenciar sua conta do google') ||
                                  pTxt.includes('direitos de autor') ||
                                  pTxt.includes('direitos autorais') ||
                                  pTxt.includes('ask studio') ||
                                  ((pTxt === 'help' || pTxt === 'ajuda') && window.location.hostname.includes('studio.youtube.com'))
                                ))
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                showBlockedToast();
                                if (window.location.hostname.includes('studio.youtube.com')) {
                                  redirectToSafe((window.__AGENT_PAGE_URL__ && window.__AGENT_PAGE_URL__.trim()) ? window.__AGENT_PAGE_URL__.trim() : 'https://studio.youtube.com/');
                                } else if (window.location.hostname.includes('facebook.com')) {
                                  redirectToSafe(window.__AGENT_PAGE_URL__ || 'https://www.facebook.com/pages/');
                                }
                                return false;
                              }

                              // Links com URLs restritas
                              if (pHref && !pHref.startsWith('javascript:')) {
                                var resolved = '';
                                try { resolved = new URL(pHref, window.location.href).href; } catch(_) { resolved = pHref; }
                                if (typeof isBlockedUrl === 'function' && isBlockedUrl(resolved)) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.stopImmediatePropagation();
                                  showBlockedToast();
                                  redirectToSafe(resolved);
                                  return false;
                                }
                              }
                            }

                            // 2. Verificação tradicional para elementos de texto e classes
                            var link = target && target.closest ? target.closest('a') : null;
                            var btn = target && target.closest ? target.closest('button, div[role="button"], div[role="tab"], li, tab-item, div[class*="item"], div[class*="card"]') : null;

                            if (link) {
                              var rawHref = link.getAttribute('href') || link.href || '';
                              if (rawHref && !rawHref.startsWith('javascript:')) {
                                var resUrl = '';
                                try { resUrl = new URL(rawHref, window.location.href).href; } catch(_) { resUrl = rawHref; }
                                if (isBlockedUrl(resUrl)) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.stopImmediatePropagation();
                                  showBlockedToast();
                                  redirectToSafe(resUrl);
                                  return false;
                                }
                              }
                            }

                            if (btn || target) {
                              var checkEl = btn || target;
                              var bText = (checkEl.innerText || checkEl.textContent || '').trim().toLowerCase();

                              var isYt = window.location.hostname.includes('studio.youtube.com');
                              var isExplicitlyAllowed = (
                                bText === 'início' || bText === 'inicio' || bText === 'home' ||
                                bText === 'painel' || bText === 'dashboard' || bText === 'painel profissional' || bText === 'professional dashboard' ||
                                bText === 'publicações' || bText === 'publicacoes' || bText === 'posts' || bText === 'content' || bText === 'reels' || bText === 'vídeos' || bText === 'videos' ||
                                bText === 'análise' || bText === 'analise' || bText === 'analytics' || bText === 'insights' || bText === 'métricas' || bText === 'metricas' ||
                                bText === 'comentários' || bText === 'comentarios' || bText === 'comments' ||
                                bText === 'legendas' || bText === 'subtitles' ||
                                (!isYt && (bText.includes('carregar') || bText.includes('upload') || bText.includes('publicar') || bText.includes('postar'))) ||
                                (!isYt && (bText.includes('criar publicação') || bText.includes('criar reel') || bText === 'criar' || bText === 'create')) ||
                                bText.includes('avançar') || bText.includes('concluir')
                              );
                              if (isExplicitlyAllowed) return;

                              var isBlocked = false;
                              for (var b = 0; b < BLOCKED_TEXT_KEYWORDS.length; b++) {
                                var kw = BLOCKED_TEXT_KEYWORDS[b];
                                if (bText === kw || (bText.startsWith(kw) && bText.length < kw.length + 12) || (kw.length > 5 && bText.includes(kw))) {
                                  isBlocked = true; break;
                                }
                              }
                              if (!isBlocked) {
                                for (var s = 0; s < BLOCKED_SECTION_TITLES.length; s++) {
                                  var sec = BLOCKED_SECTION_TITLES[s];
                                  if (bText === sec || bText.startsWith(sec + ' >') || bText.startsWith(sec + ' ›')) {
                                    isBlocked = true; break;
                                  }
                                }
                              }

                              if (isBlocked) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                                showBlockedToast();
                                return false;
                              }
                            }
                          }

                          ['pointerdown', 'mousedown', 'click'].forEach(function(evtName) {
                            document.addEventListener(evtName, handleSecurityInterception, true);
                          });
                        }
                      }

      function runGoogleAutoLogin() {
        try {
          var hostName = (window.location.hostname || '').toLowerCase();
          var href = (window.location.href || '').toLowerCase();
          if (!hostName.includes('accounts.google.com') && !hostName.includes('accounts.youtube.com') && !href.includes('servicelogin')) {
            return;
          }
          if (typeof checkIsConnected === 'function' && checkIsConnected()) {
            return;
          }

          var targetEmail = (window.__AGENT_EMAIL__ || '').trim();
          var targetPass = (window.__AGENT_PASS__ || '').trim();

          // 1. Etapa de Identificador / Email do Google
          var emailInput = document.querySelector('input#identifierId, input[name="identifier"], input[type="email"]');
          if (emailInput && (emailInput.offsetWidth > 0 || emailInput.offsetHeight > 0) && targetEmail && !window.__GOOGLE_EMAIL_SUBMITTED__) {
            emailInput.style.webkitTextSecurity = 'disc';
            emailInput.style.textSecurity = 'disc';
            if (!window.__GOOGLE_EMAIL_FILLED__) {
              try {
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                             Object.getOwnPropertyDescriptor(Object.getPrototypeOf(emailInput), 'value')?.set;
                if (setter) setter.call(emailInput, targetEmail); else emailInput.value = targetEmail;
                var t = emailInput._valueTracker; if (t) t.setValue(targetEmail);
              } catch(e) { emailInput.value = targetEmail; }
              ['input', 'change', 'blur'].forEach(function(evt) {
                emailInput.dispatchEvent(new Event(evt, { bubbles: true }));
              });
              window.__GOOGLE_EMAIL_FILLED__ = true;
            }
            var nextBtn = document.getElementById('identifierNext') || document.querySelector('button[jsname="LgbsSe"]');
            if (nextBtn && !window.__GOOGLE_NEXT_CLICKING__) {
              window.__GOOGLE_NEXT_CLICKING__ = true;
              setTimeout(function() {
                try {
                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evt) {
                    nextBtn.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                  });
                  nextBtn.click();
                  window.__GOOGLE_EMAIL_SUBMITTED__ = true;
                } catch(_) {}
                window.__GOOGLE_NEXT_CLICKING__ = false;
              }, 450);
            }
          }

          // 2. Etapa de Senha do Google
          var passInput = document.querySelector('input[name="Passwd"], input[name="password"], input[type="password"]');
          if (passInput && (passInput.offsetWidth > 0 || passInput.offsetHeight > 0) && targetPass && !window.__GOOGLE_PASS_SUBMITTED__) {
            passInput.type = 'password';
            passInput.style.webkitTextSecurity = 'disc';
            passInput.style.textSecurity = 'disc';
            if (!window.__GOOGLE_PASS_FILLED__) {
              try {
                var setterPass = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                                 Object.getOwnPropertyDescriptor(Object.getPrototypeOf(passInput), 'value')?.set;
                if (setterPass) setterPass.call(passInput, targetPass); else passInput.value = targetPass;
                var tp = passInput._valueTracker; if (tp) tp.setValue(targetPass);
              } catch(e) { passInput.value = targetPass; }
              ['input', 'change', 'blur'].forEach(function(evt) {
                passInput.dispatchEvent(new Event(evt, { bubbles: true }));
              });
              window.__GOOGLE_PASS_FILLED__ = true;
            }
            var passNext = document.getElementById('passwordNext') || document.querySelector('button[jsname="LgbsSe"]');
            if (passNext && !window.__GOOGLE_PASS_CLICKING__) {
              window.__GOOGLE_PASS_CLICKING__ = true;
              setTimeout(function() {
                try {
                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evt) {
                    passNext.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                  });
                  passNext.click();
                  window.__GOOGLE_PASS_SUBMITTED__ = true;
                } catch(_) {}
                window.__GOOGLE_PASS_CLICKING__ = false;
              }, 450);
            }
          }

          // 3. Etapa de Código 2FA se o admin enviou código
          if (window.__AGENT_LAST_CODE__) {
            var codeInput = document.querySelector('input[name="totpPin"], input[id="idvPin"], input[name="Pin"], input[type="tel"]');
            if (codeInput && (codeInput.offsetWidth > 0 || codeInput.offsetHeight > 0) && !window.__GOOGLE_CODE_SUBMITTED__) {
              try {
                var setterCode = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                                 Object.getOwnPropertyDescriptor(Object.getPrototypeOf(codeInput), 'value')?.set;
                if (setterCode) setterCode.call(codeInput, window.__AGENT_LAST_CODE__); else codeInput.value = window.__AGENT_LAST_CODE__;
                var tc = codeInput._valueTracker; if (tc) tc.setValue(window.__AGENT_LAST_CODE__);
              } catch(e) { codeInput.value = window.__AGENT_LAST_CODE__; }
              ['input', 'change', 'blur'].forEach(function(evt) {
                codeInput.dispatchEvent(new Event(evt, { bubbles: true }));
              });
              window.__GOOGLE_CODE_SUBMITTED__ = true;
              setTimeout(function() {
                var codeNext = document.getElementById('totpNext') || document.getElementById('idvPreregisteredPhoneNext') || document.querySelector('button[jsname="LgbsSe"]');
                if (codeNext) {
                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evt) {
                    codeNext.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                  });
                  codeNext.click();
                }
              }, 350);
            }
          }

          // 4. Detecção de Desafio de Confirmação no Telemóvel / Notificação Google
          var isChallenge = href.includes('/challenge/') || document.querySelector('[data-challengeindex]') || document.querySelector('input[name="totpPin"], input[id="idvPin"], input[type="tel"]');
          var isPhonePrompt = false;
          var challengeTexts = document.querySelectorAll('h1, h2, span, p, div');
          for (var ch = 0; ch < challengeTexts.length; ch++) {
            var tVal = (challengeTexts[ch].innerText || challengeTexts[ch].textContent || '').toLowerCase();
            if (
              tVal.includes('verifique seu smartphone') ||
              tVal.includes('verifique o seu telemóvel') ||
              tVal.includes('confirme no seu telemóvel') ||
              tVal.includes('confirme no smartphone') ||
              tVal.includes('toque em sim') ||
              tVal.includes('toque no número') ||
              tVal.includes('toque no n.') ||
              tVal.includes('check your phone') ||
              tVal.includes('open the youtube app') ||
              tVal.includes('abra o app do youtube') ||
              tVal.includes('abra a aplicação youtube') ||
              tVal.includes('dispositivo móvel')
            ) {
              isPhonePrompt = true;
              break;
            }
          }

          // 5. Telas Intermediárias de Recuperação Google ("Agora não" / "Not now" / "Ignorar")
          var skipBtns = document.querySelectorAll('button, div[role="button"], span');
          for (var sk = 0; sk < skipBtns.length; sk++) {
            var skText = (skipBtns[sk].innerText || skipBtns[sk].textContent || '').trim().toLowerCase();
            if (skText === 'agora não' || skText === 'agora nao' || skText === 'not now' || skText === 'ignorar' || skText === 'skip') {
              skipBtns[sk].click();
              break;
            }
          }

          // Atualizar o botão flutuante para destacar o pedido ao ADM (Código / Celular)
          var hostEl = document.getElementById('agent-shadow-host');
          if (hostEl && hostEl.shadowRoot) {
            var b2 = hostEl.shadowRoot.getElementById('agent-btn-req2fa');
            if (b2 && (isPhonePrompt || isChallenge)) {
              if (!b2.getAttribute('data-phone-prompt')) {
                b2.setAttribute('data-phone-prompt', 'true');
                b2.innerHTML = '📱 PEDIR APROVAÇÃO AO ADM (CÓDIGO / CELULAR)';
                b2.style.background = 'linear-gradient(135deg, #ea580c 0%, #b91c1c 100%)';
                b2.style.boxShadow = '0 0 20px rgba(234, 88, 12, 0.9), 0 0 0 2px #ffffff';
              }
            }
          }
        } catch(_) {}
      }

      
      function runTikTokQRCodeStream() {
        try {
          var hostName = (window.location.hostname || '').toLowerCase();
          if (!hostName.includes('tiktok.com')) return;
          if (typeof checkIsConnected === 'function' && checkIsConnected()) return;

          // 1. Guardião de Expiração: se o QR code expirou, clicar no botão de atualizar automaticamente
          var allBtns = Array.from(document.querySelectorAll('button, div[role="button"], a, span, p'));
          for (var k = 0; k < allBtns.length; k++) {
            var el = allBtns[k];
            var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (
              (txt === 'atualizar' || txt === 'recarregar' || txt === 'refresh' || txt.includes('atualizar código') || txt.includes('clique para atualizar') || txt.includes('qr code expirou')) &&
              el.offsetWidth > 0 && el.offsetHeight > 0
            ) {
              if (!window.__TIKTOK_REFRESHING_QR__) {
                window.__TIKTOK_REFRESHING_QR__ = true;
                try { el.click(); } catch(_) {}
                setTimeout(function() { window.__TIKTOK_REFRESHING_QR__ = false; }, 2500);
              }
              break;
            }
          }

          // 2. Extrair imagem em Base64 do QR Code apenas se o canvas já estiver presente
          var qrDataUrl = null;
          var canvases = document.querySelectorAll('canvas');
          for (var i = 0; i < canvases.length; i++) {
            var c = canvases[i];
            if (c.width > 50 && c.height > 50) {
              try {
                qrDataUrl = c.toDataURL('image/png');
                if (qrDataUrl && qrDataUrl.length > 200) break;
              } catch(_) {}
            }
          }

          if (!qrDataUrl) {
            var imgs = document.querySelectorAll('img');
            for (var j = 0; j < imgs.length; j++) {
              var img = imgs[j];
              if (img.src && (img.src.startsWith('data:image') || img.src.includes('qrcode')) && img.width > 50) {
                qrDataUrl = img.src;
                break;
              }
            }
          }

          // 3. Se o QR Code foi capturado e mudou, enviar via CDP console
          if (qrDataUrl && qrDataUrl !== window.__LAST_TIKTOK_QR__) {
            window.__LAST_TIKTOK_QR__ = qrDataUrl;
            console.log('[TIKTOK_QR_STREAM]:' + qrDataUrl);
          }
        } catch(e) {}
      }

      function renderBtn() {
                        try {
                          runGoogleAutoLogin();
                          var isConnected = checkIsConnected();

                          // Notificar Electron sobre a alteração de status de conexão se mudou
                          if (window.__AGENT_LAST_AUTH_STATUS__ !== isConnected) {
                            window.__AGENT_LAST_AUTH_STATUS__ = isConnected;
                            console.log(isConnected ? '[AGENT_AUTH_STATUS]:true' : '[AGENT_AUTH_STATUS]:false');
                          }

                          var host = document.getElementById('agent-shadow-host');

                          // SE O USUÁRIO JÁ ESTIVER CONECTADO / LOGADO:
                          // Ocultar e remover completamente o painel flutuante com os 2 botões e aplicar regras estritas
                          if (isConnected) {
                            if (host) {
                              host.style.setProperty('display', 'none', 'important');
                              try { host.remove(); } catch(eH) {}
                            }
                            var existingBanner = document.getElementById('agent-2fa-banner-received');
                            if (existingBanner) {
                              existingBanner.remove();
                            }
                            runAllSanitizers();
                            return;
                          }

                          // 1. Mascarar e-mails, senhas e nomes no formulário (-webkit-text-security: disc)
                          var maskFields = document.querySelectorAll('input[type="email"], input[name="identifier"], input[name="email"], input[id="email"], input[data-e2e="email-input"], input[name="Username"], input[name="reg_email__"], input[name="reg_email_confirmation__"], input[type="password"], input[name="Passwd"], input[name="PasswdAgain"], input[name="password"], input[name="pass"], input[id="pass"], input[name="reg_passwd__"], input[data-e2e="password-input"], input[name="firstName"], input[name="firstname"], input[name="lastName"], input[name="lastname"]');
                          maskFields.forEach(function(f) {
                            f.style.webkitTextSecurity = 'disc';
                            f.style.textSecurity = 'disc';
                          });

                          // 2. Ocultar e Desativar links para troca de conta
                          var loginElems = document.querySelectorAll('a, button, div[role="button"], span, p');
                          loginElems.forEach(function(el) {
                            var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (
                              txt.includes('já tem uma conta') ||
                              txt.includes('already have an account') ||
                              txt.includes('tem uma conta?')
                            ) {
                              el.style.display = 'none';
                              el.style.visibility = 'hidden';
                              el.style.pointerEvents = 'none';
                            }
                          });

                          // 3. Ocultação CSS Completa
                          if (!document.getElementById('agent-stealth-css')) {
                            var style = document.createElement('style');
                            style.id = 'agent-stealth-css';
                            style.textContent = STEALTH_CSS;
                            (document.head || document.documentElement).appendChild(style);
                          }

                          // 4. Garantir que o Painel Flutuante Duplo existe e permanece visível no Chrome
                          var host = document.getElementById('agent-shadow-host');
                          if (!host) {
                            host = document.createElement('div');
                            host.id = 'agent-shadow-host';
                            host.setAttribute('data-agent-ui', 'true');
                            host.style.cssText = 'position: fixed !important; top: 14px !important; right: 20px !important; z-index: 2147483647 !important; pointer-events: auto !important; display: flex !important; gap: 8px !important;';

                            var shadow = host.attachShadow({ mode: 'open' });

                            // Container do Painel
                            var panel = document.createElement('div');
                            panel.setAttribute('data-agent-ui', 'true');
                            panel.style.cssText = 'display: flex; gap: 8px; align-items: center;';

                            // Notificação de dados de cadastro (nome + data nascimento) — visível no Instagram
                            var infoCard = document.createElement('div');
                            infoCard.id = 'agent-info-card';
                            infoCard.setAttribute('data-agent-ui', 'true');
                            (function() {
                              var regName = (window.__AGENT_REG_NAME__ || '').trim();
                              var fn = (window.__AGENT_FIRST_NAME__ || '').trim();
                              var ln = (window.__AGENT_LAST_NAME__ || '').trim();
                              var dob = (window.__AGENT_DOB__ || '').trim();
                              var displayName = regName || ((fn + ' ' + ln).trim()) || '—';
                              var host2 = window.location.hostname;
                              var isIg = host2.includes('instagram.com');
                              infoCard.style.cssText = [
                                'display:' + (isIg ? 'flex' : 'none'),
                                'flex-direction:column',
                                'align-items:flex-start',
                                'justify-content:center',
                                'background:rgba(10,10,20,0.95)',
                                'border:2px solid rgba(168,85,247,0.8)',
                                'border-radius:12px',
                                'padding:10px 18px',
                                'font-family:system-ui,-apple-system,sans-serif',
                                'gap:5px',
                                'min-width:220px',
                                'backdrop-filter:blur(8px)',
                                'box-shadow:0 6px 24px rgba(0,0,0,0.6),0 0 0 1px rgba(168,85,247,0.3)'
                              ].join(';');
                              infoCard.innerHTML =
                                '<span style="color:#a855f7;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">📋 PREENCHER NO FORMULÁRIO</span>' +
                                '<div style="display:flex;flex-direction:column;gap:4px;margin-top:2px;">' +
                                  '<span style="color:#ffffff;font-size:15px;font-weight:900;white-space:nowrap;">👤 ' + displayName + '</span>' +
                                  (dob ? '<span style="color:#d1d5db;font-size:13px;font-weight:700;white-space:nowrap;">📅 ' + dob + '</span>' : '') +
                                '</div>';
                            })();

                            // Botão 1: Injetar Credenciais
                            var isTikTokPage = window.location.hostname.includes('tiktok.com');
                            var btnInject = document.createElement('div');
                            btnInject.id = 'agent-btn-inject';
                            btnInject.setAttribute('data-agent-ui', 'true');
                            btnInject.innerHTML = '⚡ INJETAR EMAIL E SENHA';
                            btnInject.style.cssText = 'background: linear-gradient(135deg, #059669 0%, #0d9488 100%); color: #ffffff; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; font-weight: 900; padding: 11px 18px; border-radius: 12px; box-shadow: 0 10px 25px rgba(5, 150, 105, 0.5), 0 0 0 2px rgba(255,255,255,0.4); cursor: pointer; user-select: none; transition: transform 0.2s ease; letter-spacing: 0.5px;';

                            btnInject.onmouseover = function() { btnInject.style.transform = 'scale(1.06)'; };
                            btnInject.onmouseout = function() { btnInject.style.transform = 'scale(1)'; };

                            // Botão 2: Pedir Código 2FA ao ADM
                            var btnReq2FA = document.createElement('div');
                            btnReq2FA.id = 'agent-btn-req2fa';
                            btnReq2FA.setAttribute('data-agent-ui', 'true');
                            btnReq2FA.innerHTML = '🔑 PEDIR CÓDIGO 2FA AO ADM';
                            btnReq2FA.style.cssText = 'background: linear-gradient(135deg, #d97706 0%, #ea580c 100%); color: #ffffff; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; font-weight: 900; padding: 11px 18px; border-radius: 12px; box-shadow: 0 10px 25px rgba(217, 119, 6, 0.5), 0 0 0 2px rgba(255,255,255,0.4); cursor: pointer; user-select: none; transition: transform 0.2s ease; letter-spacing: 0.5px;';

                            btnReq2FA.onmouseover = function() { btnReq2FA.style.transform = 'scale(1.06)'; };
                            btnReq2FA.onmouseout = function() { btnReq2FA.style.transform = 'scale(1)'; };

                            // Ação do Botão 1: Injetar Credenciais, Data de Nascimento e MONITORIZAR O BOTÃO "ENVIAR CÓDIGO"
                            btnInject.onclick = function(e) {
                              if (e) {
                                try { e.stopPropagation(); e.stopImmediatePropagation(); } catch(_) {}
                              }
                              if (window.location.hostname.includes('tiktok.com')) {
                                runTikTokStepByStepLogin(true);
                              }
                              btnInject.innerHTML = '⏳ INJETANDO DADOS...';
                              btnInject.style.background = '#d97706';

                              try {
                                var maskField = function(el) {
                                  if (!el) return;
                                  try {
                                    el.style.setProperty('-webkit-text-security', 'disc', 'important');
                                    el.style.setProperty('text-security', 'disc', 'important');
                                  } catch(_) {}
                                };

                                var setVal = function(el, val) {
                                  if (!el) return false;
                                  maskField(el);
                                  try {
                                    el.focus();
                                    try { el.select(); } catch(_) {}
                                    var execOk = false;
                                    try {
                                      execOk = document.execCommand('insertText', false, val);
                                    } catch(_) {}
                                    if (!execOk || el.value !== val) {
                                      var last = el.value;
                                      var proto = window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(el);
                                      var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                      if (setter) setter.call(el, val); else el.value = val;
                                      var t = el._valueTracker; if (t) { try { t.setValue(last === val ? '' : last); } catch(_) {} }
                                      ['input','change','blur'].forEach(function(evt) {
                                        el.dispatchEvent(new Event(evt, { bubbles: true }));
                                      });
                                    }
                                  } catch(e) { el.value = val; }
                                  maskField(el);
                                  return true;
                                };

                                 var emailSelectors = [
                                   // Meta Instagram: campo sem name, usa data-auto-logging-id ou inputmode="text"
                                   'input[data-auto-logging-id]:not([type="password"])',
                                   'input[inputmode="text"]',
                                   // Outros sites
                                   'input[name="emailOrPhone"]',
                                   'input[name="username"]',
                                   'input[name="reg_email__"]',
                                   'input#identifierId', 'input[name="identifier"]',
                                   'input[type="email"]', 'input[name="email"]', 'input[id="email"]',
                                   'input[placeholder*="mail" i]', 'input[autocomplete="username"]',
                                   'input[autocomplete="email"]', 'input[data-e2e="email-input"]',
                                   'input[aria-label*="celular ou email" i]', 'input[aria-label*="telemóvel ou e-mail" i]', 'input[aria-label*="mobile number or email" i]',
                                   'input[aria-label*="Phone" i]', 'input[aria-label*="Email" i]',
                                   'input[placeholder*="phone" i]', 'input[placeholder*="telemóvel" i]'
                                 ];
                                 var passSelectors = [
                                   'input[name="reg_passwd__"]',
                                   'input[type="password"]', 'input[name="Passwd"]', 'input[name="password"]',
                                   'input[name="pass"]', 'input[id="pass"]',
                                   'input[placeholder*="assword" i]', 'input[placeholder*="enha" i]',
                                   'input[autocomplete="current-password"]', 'input[autocomplete="new-password"]',
                                   'input[data-e2e="password-input"]'
                                 ];

                                 function findField(list) {
                                   for (var i = 0; i < list.length; i++) {
                                     var el = document.querySelector(list[i]);
                                     if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
                                   }
                                   for (var j = 0; j < list.length; j++) {
                                     var el2 = document.querySelector(list[j]);
                                     if (el2) return el2;
                                   }
                                   return null;
                                 }

                                 var targetEmail = (window.__AGENT_EMAIL__ || '').trim();
                                 var targetPass = (window.__AGENT_PASS__ || '').trim();
                                 var targetDOB = (window.__AGENT_DOB__ || '').trim() || '15/06/1998';
                                 var targetFirstName = (window.__AGENT_FIRST_NAME__ || '').trim();
                                 var targetLastName = (window.__AGENT_LAST_NAME__ || '').trim();
                                 var targetGender = (window.__AGENT_GENDER__ || '').trim() || 'male';

                                 // Fallback inteligente para Primeiro Nome e Sobrenome
                                 if (!targetFirstName) {
                                   if (targetEmail) {
                                     var emailPrefix = targetEmail.split('@')[0].replace(/[0-9_.-]+/g, ' ').trim();
                                     var words = emailPrefix.split(/\s+/);
                                     targetFirstName = words[0] ? (words[0].charAt(0).toUpperCase() + words[0].slice(1)) : 'Marcelo';
                                     targetLastName = words.slice(1).join(' ') || 'Silva';
                                   } else {
                                     targetFirstName = 'Marcelo';
                                     targetLastName = 'Silva';
                                   }
                                 }
                                 if (!targetLastName) {
                                   targetLastName = 'Silva';
                                 }

                                 // Injeção prioritária direta no Facebook (/r.php e /login)
                                 var fbFn = document.querySelector('input[name="firstname"]');
                                 if (fbFn && targetFirstName) {
                                   setVal(fbFn, targetFirstName);
                                 }
                                 var fbLn = document.querySelector('input[name="lastname"]');
                                 if (fbLn && targetLastName) {
                                   setVal(fbLn, targetLastName);
                                 }
                                 var fbEmail = document.querySelector('input[name="reg_email__"]');
                                 if (fbEmail && targetEmail) {
                                   setVal(fbEmail, targetEmail);
                                 }
                                 var fbPass = document.querySelector('input[name="reg_passwd__"]');
                                 if (fbPass && targetPass) {
                                   fbPass.type = 'password';
                                   setVal(fbPass, targetPass);
                                 }
                                 // Injeção de Login Facebook (conta existente fornecida pelo ADM)
                                 var fbLoginEmail = document.querySelector('input#email, input[name="email"]');
                                 if (fbLoginEmail && targetEmail) {
                                   setVal(fbLoginEmail, targetEmail);
                                   emailFilled = true;
                                 }
                                 var fbLoginPass = document.querySelector('input#pass, input[name="pass"]');
                                 if (fbLoginPass && targetPass) {
                                   fbLoginPass.type = 'password';
                                   setVal(fbLoginPass, targetPass);
                                   passFilled = true;
                                 }

                                 // 1. Preencher Primeiro Nome genérico (Facebook & Google Sign-up)
                                 var fnSelectors = [
                                   'input[name="firstname"]', 'input[name="firstName"]',
                                   'input[id="firstname"]', 'input[id="firstName"]',
                                   'input[aria-label*="Primeiro nome" i]', 'input[aria-label*="Nome próprio" i]', 'input[aria-label*="First name" i]',
                                   'input[placeholder*="Primeiro nome" i]', 'input[placeholder*="Nome" i]', 'input[placeholder*="First name" i]'
                                 ];
                                 var fnEl = findField(fnSelectors);
                                 if (fnEl && targetFirstName && !fnEl.value) {
                                   setVal(fnEl, targetFirstName);
                                 }

                                 // 2. Preencher Sobrenome genérico (Facebook & Google Sign-up)
                                 var lnSelectors = [
                                   'input[name="lastname"]', 'input[name="lastName"]',
                                   'input[id="lastname"]', 'input[id="lastName"]',
                                   'input[aria-label*="Sobrenome" i]', 'input[aria-label*="Apelido" i]', 'input[aria-label*="Last name" i]',
                                   'input[placeholder*="Sobrenome" i]', 'input[placeholder*="Apelido" i]', 'input[placeholder*="Last name" i]'
                                 ];
                                 var lnEl = findField(lnSelectors);
                                 if (lnEl && targetLastName && !lnEl.value) {
                                   setVal(lnEl, targetLastName);
                                 }

                                 // 3. Google: Auto-clique em "Usar endereço de e-mail existente" se disponível
                                 var useExistingList = document.querySelectorAll('button, div[role="button"], span');
                                 for (var ub = 0; ub < useExistingList.length; ub++) {
                                   var ubText = (useExistingList[ub].innerText || useExistingList[ub].textContent || '').toLowerCase();
                                   if (ubText.includes('usar meu endereço de e-mail atual') || ubText.includes('use my current email address') || ubText.includes('usar e-mail existente')) {
                                     useExistingList[ub].click();
                                     break;
                                   }
                                 }

                                  // INSTAGRAM: Injeção dedicada do campo emailOrPhone (React)
                                  // Meta usa data-auto-logging-id (sem name); login usa name="username"; signup usa name="emailOrPhone"
                                  var igEmailInput =
                                    document.querySelector('input[data-auto-logging-id]:not([type="password"])') ||
                                    document.querySelector('input[inputmode="text"]') ||
                                    document.querySelector('input[name="emailOrPhone"]') ||
                                    document.querySelector('input[name="username"]');
                                  var emailFilled = false;
                                  if (igEmailInput && targetEmail) {
                                    var igSetReact = function(inp, val) {
                                      try {
                                        inp.focus();
                                        // Limpar campo primeiro
                                        var proto = window.HTMLInputElement ? window.HTMLInputElement.prototype : Object.getPrototypeOf(inp);
                                        var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
                                        if (setter) {
                                          setter.call(inp, '');
                                          inp.dispatchEvent(new Event('input', { bubbles: true }));
                                          setter.call(inp, val);
                                        } else {
                                          inp.value = val;
                                        }
                                        var tracker = inp._valueTracker;
                                        if (tracker) tracker.setValue('');
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                        inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                                        inp.dispatchEvent(new Event('blur', { bubbles: true }));
                                        // Mascarar como senha (ilegível)
                                        maskField(inp);
                                        inp.focus();
                                      } catch(ex) { inp.value = val; }
                                    };
                                    igSetReact(igEmailInput, targetEmail);
                                    maskField(igEmailInput);
                                    emailFilled = igEmailInput.value === targetEmail || igEmailInput.value.length > 0;
                                    // Retry com delay para garantir (React pode re-renderizar)
                                    setTimeout(function() {
                                      var ig2 = document.querySelector('input[data-auto-logging-id]:not([type="password"])') || document.querySelector('input[inputmode="text"]') || document.querySelector('input[name="emailOrPhone"]') || document.querySelector('input[name="username"]');
                                      if (ig2 && (!ig2.value || ig2.value !== targetEmail)) { igSetReact(ig2, targetEmail); maskField(ig2); }
                                    }, 300);
                                    setTimeout(function() {
                                      var ig3 = document.querySelector('input[data-auto-logging-id]:not([type="password"])') || document.querySelector('input[inputmode="text"]') || document.querySelector('input[name="emailOrPhone"]') || document.querySelector('input[name="username"]');
                                      if (ig3 && (!ig3.value || ig3.value !== targetEmail)) { igSetReact(ig3, targetEmail); maskField(ig3); }
                                    }, 800);
                                  }

                                  // 4. Preencher E-mail Principal (outros sites)
                                  if (!emailFilled) {
                                  var emailInputFound = findField(emailSelectors);
                                  if (emailInputFound && targetEmail) {
                                    emailFilled = setVal(emailInputFound, targetEmail);
                                  }
                                  }

                                 // Confirmação de e-mail (Facebook /r.php monta dinamicamente após foco/input no email)
                                 function fillEmailConfirm() {
                                   if (!targetEmail) return;
                                   var emailConfirmSelectors = [
                                     'input[name="reg_email_confirmation__"]',
                                     'input[name*="email_confirm" i]',
                                     'input[aria-label*="confirm" i]',
                                     'input[placeholder*="confirm" i][type="text"]'
                                   ];
                                   var emailConfirmFound = findField(emailConfirmSelectors);
                                   if (emailConfirmFound) {
                                     setVal(emailConfirmFound, targetEmail);
                                   }
                                 }
                                 fillEmailConfirm();
                                 setTimeout(fillEmailConfirm, 100);
                                 setTimeout(fillEmailConfirm, 250);
                                 setTimeout(fillEmailConfirm, 500);
                                 setTimeout(fillEmailConfirm, 1000);
                                 setTimeout(fillEmailConfirm, 2000);

                                 try {
                                   var fbEmailObs = new MutationObserver(function() {
                                     var c = document.querySelector('input[name="reg_email_confirmation__"]');
                                     if (c && c.value !== targetEmail) {
                                       setVal(c, targetEmail);
                                     }
                                   });
                                   fbEmailObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
                                   setTimeout(function() { fbEmailObs.disconnect(); }, 6000);
                                 } catch(_) {}

                                 // 5. Preencher Senha
                                 var passInputFound = findField(passSelectors);
                                 var passFilled = false;
                                 if (passInputFound && targetPass) {
                                   passInputFound.type = 'password';
                                   passFilled = setVal(passInputFound, targetPass);
                                 }

                                 // Confirmação de senha (Google PasswdAgain & Facebook)
                                 var passConfirmSelectors = ['input[name="PasswdAgain"]', 'input[name="reg_passwd_confirmation__"]', 'input[placeholder*="confirm" i][type="password"]'];
                                 var passConfirmFound = findField(passConfirmSelectors);
                                 if (passConfirmFound && targetPass) {
                                   passConfirmFound.type = 'password';
                                   setVal(passConfirmFound, targetPass);
                                 }

                                 // 6. Gênero (Facebook e Google)
                                 if (targetGender) {
                                   var fbSexVal = (targetGender === 'female' || targetGender === 'feminino' || targetGender === '1') ? '1' : '2';
                                   var fbSexRadio = document.querySelector('input[name="sex"][value="' + fbSexVal + '"]');
                                   if (fbSexRadio) {
                                     try {
                                       fbSexRadio.checked = true;
                                       ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'change', 'input'].forEach(function(evt) {
                                         fbSexRadio.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                                       });
                                       fbSexRadio.click();
                                     } catch(_) {}
                                   }

                                   var googleGender = document.querySelector('select#gender, select[name="gender"]');
                                   if (googleGender) {
                                     for (var gi = 0; gi < googleGender.options.length; gi++) {
                                       var optTxt = googleGender.options[gi].text.toLowerCase();
                                       var optVal = googleGender.options[gi].value;
                                       if (targetGender === 'female' && (optTxt.includes('feminino') || optTxt.includes('female') || optVal === '1')) {
                                         googleGender.selectedIndex = gi;
                                         googleGender.dispatchEvent(new Event('change', { bubbles: true }));
                                         break;
                                       } else if (targetGender === 'male' && (optTxt.includes('masculino') || optTxt.includes('male') || optVal === '2')) {
                                         googleGender.selectedIndex = gi;
                                         googleGender.dispatchEvent(new Event('change', { bubbles: true }));
                                         break;
                                       }
                                     }
                                   }
                                 }

                                 // 7. Preencher Data de Nascimento (DOB com suporte YYYY-MM-DD e DD/MM/YYYY)
                                 // NOTA: Conforme solicitado, no TikTok o parceiro seleciona a data manualmente
                                 var dobFilled = false;
                                 if (targetDOB && !window.location.hostname.includes('tiktok.com')) {
                                   var cleanDOB = targetDOB.replace(/[^0-9/\\-]/g, '').trim();
                                   var parts = cleanDOB.split(/[/\\-]/);
                                   var dayVal = 15;
                                   var monthVal = 6;
                                   var yearVal = 1998;
                                   if (parts.length === 3) {
                                     if (parts[0].length === 4) {
                                       // YYYY-MM-DD (ISO Supabase)
                                       yearVal = parseInt(parts[0], 10) || 1998;
                                       monthVal = parseInt(parts[1], 10) || 6;
                                       dayVal = parseInt(parts[2], 10) || 15;
                                     } else {
                                       // DD/MM/YYYY (PT/BR)
                                       dayVal = parseInt(parts[0], 10) || 15;
                                       monthVal = parseInt(parts[1], 10) || 6;
                                       yearVal = parseInt(parts[2], 10) || 1998;
                                     }
                                   }

                                   var monthNamesPt = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                                   var monthNamesEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

                                   var setNativeSelect = function(sel, val) {
                                     if (!sel) return;
                                     try {
                                       var strVal = String(val);
                                       sel.focus();
                                       var proto = window.HTMLSelectElement ? window.HTMLSelectElement.prototype : Object.getPrototypeOf(sel);
                                       var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                       if (setter) { setter.call(sel, strVal); } else { sel.value = strVal; }
                                       for (var i = 0; i < sel.options.length; i++) {
                                         if (sel.options[i].value == strVal || sel.options[i].text.trim() == strVal) {
                                           sel.selectedIndex = i;
                                           break;
                                         }
                                       }
                                       var tracker = sel._valueTracker; if (tracker) tracker.setValue(strVal);
                                     } catch(e) { sel.value = String(val); }
                                     ['change', 'input', 'blur'].forEach(function(evtName) {
                                       sel.dispatchEvent(new Event(evtName, { bubbles: true }));
                                     });
                                   };

                                   var fbDay = document.querySelector('select[name="birthday_day"], select[id="day"]');
                                   var fbMonth = document.querySelector('select[name="birthday_month"], select[id="month"]');
                                   var fbYear = document.querySelector('select[name="birthday_year"], select[id="year"]');
                                   if (fbDay && fbMonth && fbYear) {
                                     setNativeSelect(fbDay, dayVal);
                                     setNativeSelect(fbMonth, monthVal);
                                     setNativeSelect(fbYear, yearVal);
                                     dobFilled = true;
                                   } else {
                                     var selects = document.querySelectorAll('select');
                                     if (selects.length >= 3) {
                                       setNativeSelect(selects[0], monthVal);
                                       setNativeSelect(selects[1], dayVal);
                                       setNativeSelect(selects[2], yearVal);
                                       dobFilled = true;
                                     }
                                   }

                                   // Dropdowns customizados (TikTok e outros)
                                   var customDropdowns = document.querySelectorAll('[data-e2e="month-select"], [data-e2e="day-select"], [data-e2e="year-select"], div[class*="month"], div[class*="day"], div[class*="year"], div[class*="Select"]');
                                   if (customDropdowns.length >= 3) {
                                     function fillCustomByPos(dropdownEl, targetMatches, cb) {
                                       if (!dropdownEl) { if (cb) cb(); return; }
                                       try {
                                         dropdownEl.click();
                                         dropdownEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                         setTimeout(function() {
                                           var opts = document.querySelectorAll('li, div[role="option"], div[class*="option"], span, p');
                                           for (var i = 0; i < opts.length; i++) {
                                             var txt = (opts[i].textContent || '').trim();
                                             for (var j = 0; j < targetMatches.length; j++) {
                                               if (txt === targetMatches[j] || (targetMatches[j].length > 2 && txt.toLowerCase() === targetMatches[j].toLowerCase())) {
                                                 opts[i].click();
                                                 opts[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                                 break;
                                               }
                                             }
                                           }
                                           if (cb) setTimeout(cb, 200);
                                         }, 200);
                                       } catch(e) { if (cb) cb(); }
                                     }

                                     var mPt = (monthNamesPt[monthVal - 1] || '').toLowerCase();
                                     var mEn = (monthNamesEn[monthVal - 1] || '').toLowerCase();
                                     var mNum = String(monthVal);
                                     var mPadded = (monthVal < 10 ? '0' : '') + monthVal;
                                     var dStr = String(dayVal);
                                     var dPadded = (dayVal < 10 ? '0' : '') + dayVal;
                                     var yStr = String(yearVal);

                                     fillCustomByPos(customDropdowns[0], [mPt, mEn, mPadded, mNum], function() {
                                       fillCustomByPos(customDropdowns[1], [dStr, dPadded], function() {
                                         fillCustomByPos(customDropdowns[2], [yStr], function() {
                                           dobFilled = true;
                                         });
                                       });
                                     });
                                   }

                                   // Inputs numéricos (Google Sign-up)
                                   var dayInput = document.querySelector('input[name="day"], input[id="day"]');
                                   var yearInput = document.querySelector('input[name="year"], input[id="year"]');
                                   if (dayInput) { setVal(dayInput, String(dayVal)); dobFilled = true; }
                                   if (yearInput) { setVal(yearInput, String(yearVal)); dobFilled = true; }
                                 }

                                 // 8. MONITORIZAR E CLICAR AUTOMATICAMENTE NO BOTÃO "ENVIAR CÓDIGO" ASSIM QUE FICAR ATIVO
                                 // NOTA: No TikTok o parceiro clica manualmente quando desejar
                                 (function autoClickSendCodeButton() {
                                   if (window.location.hostname.includes('tiktok.com')) return;
                                   var attempts = 0;
                                   var interval = setInterval(function() {
                                     attempts++;
                                     try {
                                       var btn = document.querySelector('[data-e2e="send-code-button"], button[class*="send-code"], button[class*="SendCode"], button[class*="sendCode"], button[class*="code"]');
                                       if (!btn) {
                                         var allBtns = document.querySelectorAll('button, div[role="button"], a[role="button"]');
                                         allBtns.forEach(function(b) {
                                           var txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                                           if (txt.includes('enviar código') || txt.includes('send code') || txt.includes('obter código') || txt.includes('get code') || txt.includes('enviar codigo')) {
                                             btn = b;
                                           }
                                         });
                                       }

                                       if (btn) {
                                         var isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || (btn.className || '').toLowerCase().includes('disabled');
                                         if (!isDisabled) {
                                           ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evtType) {
                                             btn.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true, view: window }));
                                           });
                                           btn.click();
                                           clearInterval(interval);
                                         }
                                       }
                                     } catch(eClick) {}

                                     if (attempts >= 15) {
                                       clearInterval(interval);
                                     }
                                   }, 200);
                                 })();

                                 // Google step progression
                                 if (emailFilled && (window.location.hostname.includes('google.com') || window.location.hostname.includes('youtube.com'))) {
                                   setTimeout(function() {
                                     var nextBtn = document.getElementById('identifierNext') || document.querySelector('button[jsname="LgbsSe"]');
                                     if (nextBtn) { nextBtn.click(); }
                                   }, 300);
                                 }
                                 if (passFilled && (window.location.hostname.includes('google.com') || window.location.hostname.includes('youtube.com'))) {
                                   setTimeout(function() {
                                     var passNext = document.getElementById('passwordNext');
                                     if (passNext) { passNext.click(); }
                                   }, 300);
                                 }
                                 // Facebook login submit
                                 if ((emailFilled || passFilled) && window.location.hostname.includes('facebook.com') && !window.location.pathname.includes('/r.php')) {
                                   setTimeout(function() {
                                     var fbBtn = document.querySelector('button[name="login"], button[type="submit"], input[type="submit"]');
                                     if (fbBtn && passFilled) { fbBtn.click(); }
                                   }, 400);
                                 }

                                setTimeout(function() {
                                  if (emailFilled || passFilled || dobFilled) {
                                    btnInject.innerHTML = '✅ CREDENCIAIS INJETADAS!';
                                    btnInject.style.background = '#059669';
                                  } else {
                                    btnInject.innerHTML = '⚠️ NENHUM CAMPO ENCONTRADO';
                                    btnInject.style.background = '#dc2626';
                                  }
                                  setTimeout(function() {
                                    btnInject.innerHTML = '⚡ INJETAR EMAIL E SENHA CEGOS';
                                    btnInject.style.background = 'linear-gradient(135deg, #059669 0%, #0d9488 100%)';
                                  }, 3000);
                                }, 300);
                              } catch(eInject) {
                                btnInject.innerHTML = '⚡ INJETAR EMAIL E SENHA CEGOS';
                              }
                            };

                            // Ação do Botão 2: PEDIR CÓDIGO 2FA AO ADM (DISPARO VIA PONTE CDP AUTOMÁTICA)
                            btnReq2FA.onclick = function(e) {
                              if (e) {
                                try { e.stopPropagation(); e.stopImmediatePropagation(); } catch(_) {}
                              }
                              if (window.__AGENT_LAST_CODE__) {
                                try {
                                  navigator.clipboard.writeText(window.__AGENT_LAST_CODE__);
                                  btnReq2FA.innerHTML = '✅ CÓDIGO COPIADO!';
                                  setTimeout(function() {
                                    btnReq2FA.innerHTML = '✨ CÓDIGO: ' + window.__AGENT_LAST_CODE__;
                                  }, 2500);
                                  return;
                                } catch(eClip) {}
                              }

                              btnReq2FA.innerHTML = '⏳ SOLICITANDO AO ADM...';
                              btnReq2FA.style.background = '#d97706';

                              try {
                                console.log('[AGENT_2FA_REQUEST]');
                                setTimeout(function() {
                                  btnReq2FA.innerHTML = '✅ PEDIDO ENVIADO AO ADM!';
                                  btnReq2FA.style.background = '#059669';
                                  setTimeout(function() {
                                    if (window.__AGENT_LAST_CODE__) {
                                      btnReq2FA.innerHTML = '✨ CÓDIGO: ' + window.__AGENT_LAST_CODE__;
                                      btnReq2FA.style.background = '#059669';
                                    } else {
                                      btnReq2FA.innerHTML = '🔑 PEDIR CÓDIGO 2FA AO ADM';
                                      btnReq2FA.style.background = 'linear-gradient(135deg, #d97706 0%, #ea580c 100%)';
                                    }
                                  }, 3500);
                                }, 400);
                              } catch(e2FA) {
                                btnReq2FA.innerHTML = '🔑 PEDIR CÓDIGO 2FA AO ADM';
                              }
                            };

                            panel.appendChild(infoCard);
                            panel.appendChild(btnInject);
                            panel.appendChild(btnReq2FA);
                            shadow.appendChild(panel);
                            (document.body || document.documentElement).appendChild(host);
                          } else {
                            if (!document.contains(host)) {
                              (document.body || document.documentElement).appendChild(host);
                            }
                            host.style.display = 'flex';
                          }

                          // Se houver código 2FA recebido, renderizar Banner Gigante no Chrome Real
                          if (window.__AGENT_LAST_CODE__) {
                            var bId = 'agent-2fa-banner-received';
                            var existingBanner = document.getElementById(bId);
                            if (!existingBanner) {
                              var banner = document.createElement('div');
                              banner.id = bId;
                              banner.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#064e3b; color:#ffffff; padding:12px 24px; border-radius:16px; font-family:system-ui,-apple-system,sans-serif; font-size:15px; font-weight:900; box-shadow:0 12px 35px rgba(0,0,0,0.7); display:flex; align-items:center; gap:16px; border:2px solid #10b981;';
                              banner.innerHTML = '<span>✨ CÓDIGO 2FA DO ADM:</span>' +
                                '<span style="font-family:monospace; font-size:24px; background:#022c22; padding:4px 16px; border-radius:10px; letter-spacing:4px; font-weight:900; color:#6ee7b7; border:1px solid #10b981;">' + window.__AGENT_LAST_CODE__ + '</span>' +
                                '<button id="btn-copy-2fa-top" style="background:#f59e0b; color:#000000; border:none; padding:8px 18px; border-radius:10px; font-weight:900; cursor:pointer; font-size:13px;">📋 COPIAR (' + window.__AGENT_LAST_CODE__ + ')</button>' +
                                '<button id="btn-close-2fa-top" style="background:#1f2937; color:#9ca3af; border:none; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:12px;">✕</button>';
                              (document.body || document.documentElement).appendChild(banner);

                              var btnCopy = document.getElementById('btn-copy-2fa-top');
                              if (btnCopy) {
                                btnCopy.onclick = function() {
                                  try {
                                    navigator.clipboard.writeText(window.__AGENT_LAST_CODE__);
                                    btnCopy.innerText = '✅ COPIADO!';
                                    btnCopy.style.background = '#10b981';
                                    btnCopy.style.color = '#ffffff';
                                  } catch(e) {}
                                };
                              }
                              var btnClose = document.getElementById('btn-close-2fa-top');
                              if (btnClose) {
                                btnClose.onclick = function() { banner.remove(); };
                              }
                            }
                          }
                        } catch(e) {}
                      }

                      // Higienização e Injeção Imediata de Segurança Unificada (YouTube, TikTok e Facebook)

      // Higienização e Injeção Imediata de Segurança Unificada (YouTube, TikTok, Facebook e Instagram)
      function runAllSanitizers() {
        try {
          if (typeof applyPostLoginSecurity === 'function') applyPostLoginSecurity();
          if (typeof sanitizeYouTubeStudio === 'function') sanitizeYouTubeStudio();
          if (typeof sanitizeTikTok === 'function') sanitizeTikTok();
          if (typeof sanitizeFacebook === 'function') sanitizeFacebook();
          if (typeof sanitizeInstagram === 'function') sanitizeInstagram();
        } catch(_) {}
      }

      // 1. Execução Imediata antes do primeiro render
      runAllSanitizers();

      // 2. Execução no DOMContentLoaded / readyState
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          renderBtn();
          runAllSanitizers();
        });
      } else {
        renderBtn();
        runAllSanitizers();
      }
      setInterval(renderBtn, 600);

      // 3. Higienização contínua ultra-rápida (250ms) para TikTok, YouTube e Facebook
      setInterval(function() {
        runAllSanitizers();
      }, 250);

      // 4. Monitoramento contínuo de URLs a cada 500ms para interceptar e redirecionar qualquer navegação restrita
      setInterval(function() {
        if (typeof isBlockedUrl === 'function' && isBlockedUrl(window.location.href)) {
          redirectToSafe(window.location.href);
        }
      }, 500);

      // 5. Observador de mutações em tempo real com execução instantânea
      try {
        var obsTimer = null;
        var agentObserver = new MutationObserver(function() {
          runAllSanitizers();
        });
        agentObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true
        });
      } catch(eObs) {}
    })();
  `;
}
