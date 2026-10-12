import * as path from "path";
import * as vscode from "vscode";

interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontId?: string;
}

interface IconThemeDocument {
  iconDefinitions?: Record<string, IconDefinition>;
  file?: string;
  fileLight?: string;
  fileExtensions?: Record<string, string>;
  fileExtensionsLight?: Record<string, string>;
  fileNames?: Record<string, string>;
  fileNamesLight?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface FileIconInfo {
  iconUri?: string;
}

export class IconThemeService {
  private themeId: string | undefined;
  private themeDoc: IconThemeDocument | undefined;
  private themeExtensionUri: vscode.Uri | undefined;
  private iconCache = new Map<string, string>();
  private loadingPromise: Promise<void> | undefined;

  public clearCache(): void {
    this.themeId = undefined;
    this.themeDoc = undefined;
    this.themeExtensionUri = undefined;
    this.iconCache.clear();
    this.loadingPromise = undefined;
  }

  public async getIconForFile(
    webview: vscode.Webview,
    filePath: string,
  ): Promise<FileIconInfo | undefined> {
    await this.ensureThemeLoaded();

    if (!this.themeDoc) {
      return undefined;
    }

    const iconId = this.getIconIdForFile(filePath, this.themeDoc);
    if (!iconId) {
      return undefined;
    }

    const iconDefinition = this.themeDoc.iconDefinitions?.[iconId];
    if (!iconDefinition?.iconPath || !this.themeExtensionUri) {
      return undefined;
    }

    const dataUri = await this.getIconDataUri(iconDefinition.iconPath);
    if (!dataUri) {
      return undefined;
    }

    return { iconUri: dataUri };
  }

  private async ensureThemeLoaded(): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    const configuredThemeId =
      vscode.workspace.getConfiguration("workbench").get<string>("iconTheme") ??
      "";
    if (this.themeDoc && this.themeId === configuredThemeId) {
      return;
    }

    this.loadingPromise = this.loadTheme(configuredThemeId);
    await this.loadingPromise;
    this.loadingPromise = undefined;
  }

  private async loadTheme(themeId: string): Promise<void> {
    this.themeId = themeId;
    this.themeDoc = undefined;
    this.themeExtensionUri = undefined;
    this.iconCache.clear();

    if (!themeId) {
      return;
    }

    for (const extension of vscode.extensions.all) {
      const contributions = extension.packageJSON?.contributes?.iconThemes as
        | Array<{ id: string; path: string }>
        | undefined;
      if (!Array.isArray(contributions)) {
        continue;
      }

      const theme = contributions.find((entry) => entry.id === themeId);
      if (!theme) {
        continue;
      }

      try {
        const themeUri = vscode.Uri.joinPath(
          extension.extensionUri,
          theme.path,
        );
        const bytes = await vscode.workspace.fs.readFile(themeUri);
        const content = Buffer.from(bytes).toString("utf8");
        this.themeDoc = JSON.parse(content) as IconThemeDocument;
        this.themeExtensionUri = vscode.Uri.joinPath(
          extension.extensionUri,
          path.dirname(theme.path),
        );
      } catch (error) {
        console.warn("[GitHub Desktop Plus] Failed to load icon theme", error);
      }
      break;
    }
  }

  private getIconIdForFile(
    filePath: string,
    theme: IconThemeDocument,
  ): string | undefined {
    const fileName = path.basename(filePath);
    const lowerFileName = fileName.toLowerCase();
    const ext = path.extname(fileName).replace(".", "").toLowerCase();

    const fileNames = theme.fileNames ?? {};
    const fileNamesLight = theme.fileNamesLight ?? {};

    const iconIdFromName =
      fileNames[fileName] ??
      fileNames[lowerFileName] ??
      fileNamesLight[fileName] ??
      fileNamesLight[lowerFileName];
    if (iconIdFromName) {
      return iconIdFromName;
    }

    if (ext) {
      const fileExtensions = theme.fileExtensions ?? {};
      const fileExtensionsLight = theme.fileExtensionsLight ?? {};
      const iconIdFromExt =
        fileExtensions[ext] ??
        fileExtensions[ext.toLowerCase()] ??
        fileExtensionsLight[ext] ??
        fileExtensionsLight[ext.toLowerCase()];
      if (iconIdFromExt) {
        return iconIdFromExt;
      }
    }

    return theme.file ?? theme.fileLight;
  }

  private async getIconDataUri(
    relativeIconPath: string,
  ): Promise<string | undefined> {
    if (!this.themeExtensionUri || !relativeIconPath) {
      return undefined;
    }

    const normalizedPath = relativeIconPath.replace(/\\/g, "/");
    const cacheKey = `${this.themeId ?? "default"}:${normalizedPath}`;
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey);
    }

    try {
      const iconUri = vscode.Uri.joinPath(
        this.themeExtensionUri,
        normalizedPath,
      );
      const bytes = await vscode.workspace.fs.readFile(iconUri);
      const ext = path.extname(normalizedPath).toLowerCase();
      const mimeType = this.getMimeType(ext);
      const dataUri = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
      this.iconCache.set(cacheKey, dataUri);
      return dataUri;
    } catch (error) {
      console.warn(
        "[GitHub Desktop Plus] Failed to load icon",
        relativeIconPath,
        error,
      );
      return undefined;
    }
  }

  private getMimeType(ext: string): string {
    switch (ext) {
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".ico":
        return "image/x-icon";
      default:
        return "image/png";
    }
  }
}

export const iconThemeService = new IconThemeService();
