import type { SVGProps } from 'react';
import {
  IconActivity as TablerActivity,
  IconAdjustments as TablerAdjustments,
  IconAdjustmentsHorizontal as TablerAdjustmentsHorizontal,
  IconAlertTriangle as TablerAlertTriangle,
  IconArchive as TablerArchive,
  IconArchiveOff as TablerArchiveOff,
  IconArrowBackUp as TablerArrowBackUp,
  IconArrowDown as TablerArrowDown,
  IconArrowFork as TablerArrowFork,
  IconArrowLeft as TablerArrowLeft,
  IconArrowNarrowLeft as TablerArrowNarrowLeft,
  IconArrowNarrowRight as TablerArrowNarrowRight,
  IconArrowRight as TablerArrowRight,
  IconArrowUp as TablerArrowUp,
  IconArrowsMinimize as TablerArrowsMinimize,
  IconBook as TablerBook,
  IconBrain as TablerBrain,
  IconBrowser as TablerBrowser,
  IconCards as TablerCards,
  IconChartBar as TablerChartBar,
  IconCheck as TablerCheck,
  IconChevronDown as TablerChevronDown,
  IconChevronLeft as TablerChevronLeft,
  IconChevronRight as TablerChevronRight,
  IconChevronUp as TablerChevronUp,
  IconCircleCheck as TablerCircleCheck,
  IconCircleX as TablerCircleX,
  IconCloud as TablerCloud,
  IconCopy as TablerCopy,
  IconDownload as TablerDownload,
  IconDots as TablerDots,
  IconDotsVertical as TablerDotsVertical,
  IconEdit as TablerEdit,
  IconEye as TablerEye,
  IconEyeOff as TablerEyeOff,
  IconFile as TablerFile,
  IconFileDescription as TablerFileDescription,
  IconFolder as TablerFolder,
  IconFolderOpen as TablerFolderOpen,
  IconFolderPlus as TablerFolderPlus,
  IconGitBranch as TablerGitBranch,
  IconHeart as TablerHeart,
  IconKeyboard as TablerKeyboard,
  IconLayoutDashboard as TablerLayoutDashboard,
  IconLayoutSidebar as TablerLayoutSidebar,
  IconLayoutSidebarRight as TablerLayoutSidebarRight,
  IconLink as TablerLink,
  IconList as TablerList,
  IconMessage as TablerMessage,
  IconMessageCircle as TablerMessageCircle,
  IconMessagePlus as TablerMessagePlus,
  IconMoon as TablerMoon,
  IconNote as TablerNote,
  IconPaperclip as TablerPaperclip,
  IconPhoto as TablerPhoto,
  IconPin as TablerPin,
  IconPlug as TablerPlug,
  IconPlus as TablerPlus,
  IconPower as TablerPower,
  IconRefresh as TablerRefresh,
  IconRobot as TablerRobot,
  IconSearch as TablerSearch,
  IconSend as TablerSend,
  IconShield as TablerShield,
  IconSparkles as TablerSparkles,
  IconSquare as TablerSquare,
  IconStar as TablerStar,
  IconSun as TablerSun,
  IconTerminal2 as TablerTerminal2,
  IconTrash as TablerTrash,
  IconUser as TablerUser,
  IconUsers as TablerUsers,
  IconX as TablerX,
} from '@tabler/icons-react';
import { IconMcp } from './brand-icons.js';

export type IconProps = SVGProps<SVGSVGElement>;

// The public names stay stable for Desktop. The visual implementation now
// comes from the downloaded Tabler Icons package rather than local drawings.
export const IconChat = TablerMessageCircle;
export const IconSideChat = TablerMessage;
export const IconCommentPlus = TablerMessagePlus;
export const IconCommentOutline = TablerMessageCircle;
export const IconCommentFilled = TablerMessage;
export const IconCommentAction = TablerMessagePlus;
export const IconBrowser = TablerBrowser;
export const IconCanvas = TablerLayoutDashboard;
export const IconFolder = TablerFolder;
export const IconFolderOpen = TablerFolderOpen;
export const IconFolderPlus = TablerFolderPlus;
export const IconSpark = TablerSparkles;
export const IconPlug = TablerPlug;
export const IconExtension = TablerLayoutDashboard;
export const IconSkill = TablerRobot;
export { IconMcp };
export const IconGit = TablerGitBranch;
export const IconArrowFork = TablerArrowFork;
export const IconPet = TablerHeart;
export const IconListTree = TablerList;
export const IconUsers = TablerUsers;
export const IconTerminal = TablerTerminal2;
export const IconDocument = TablerFileDescription;
export const IconFile = TablerFile;
export const IconNote = TablerNote;
export const IconBook = TablerBook;
export const IconCards = TablerCards;
export const IconActivity = TablerActivity;
export const IconAgent = TablerRobot;
export const IconBrain = TablerBrain;
export const IconSettings = TablerAdjustmentsHorizontal;
export const IconSliders = TablerAdjustments;
export const IconPlus = TablerPlus;
export const IconSearch = TablerSearch;
export const IconSend = TablerArrowUp;
export const IconPaperclip = TablerPaperclip;
export const IconStop = TablerSquare;
export const IconCompress = TablerArrowsMinimize;
export const IconMore = TablerDots;
export const IconMoreVertical = TablerDotsVertical;
export const IconArchive = TablerArchive;
export const IconUnarchive = TablerArchiveOff;
export const IconTrash = TablerTrash;
export const IconCopy = TablerCopy;
export const IconCheck = TablerCheck;
export const IconRevert = TablerArrowBackUp;
export const IconLink = TablerLink;
export const IconDownload = TablerDownload;
export const IconMenuList = TablerList;
export const IconRefresh = TablerRefresh;
export const IconPanelRight = TablerLayoutSidebarRight;
export const IconPanelLeft = TablerLayoutSidebar;
export const IconClose = TablerX;
export const IconBack = TablerArrowNarrowLeft;
export const IconChevronLeft = TablerChevronLeft;
export const IconChevronRight = TablerChevronRight;
export const IconChevronDown = TablerChevronDown;
export const IconChevronUp = TablerChevronUp;
export const IconEdit = TablerEdit;
export const IconPin = TablerPin;
export const IconStar = TablerStar;
export const IconWarn = TablerAlertTriangle;
export const IconExpand = TablerLayoutDashboard;
export const IconMoon = TablerMoon;
export const IconSun = TablerSun;

// Additional downloaded-library primitives used by future settings and
// compact controls. They are explicit exports instead of another local SVG.
export const IconEye = TablerEye;
export const IconEyeOff = TablerEyeOff;
export const IconAlertCircle = TablerCircleX;
export const IconCheckCircle = TablerCircleCheck;
export const IconShield = TablerShield;
export const IconPower = TablerPower;
export const IconImage = TablerPhoto;
export const IconKeyboard = TablerKeyboard;
export const IconChartBar = TablerChartBar;
export const IconHeart = TablerHeart;
export const IconUser = TablerUser;
export const IconCloud = TablerCloud;
export const IconArrowLeft = TablerArrowLeft;
export const IconArrowRight = TablerArrowRight;
export const IconArrowDown = TablerArrowDown;
export const IconArrowUp = TablerArrowUp;
export const IconSendFilled = TablerSend;
export const IconNarrowRight = TablerArrowNarrowRight;
export const IconNarrowLeft = TablerArrowNarrowLeft;
