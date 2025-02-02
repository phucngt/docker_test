/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import fs = require("fs");
import path = require("path");
import * as vscode from "vscode";

import { BookmarkedFile, NO_BOOKMARKS_AFTER, NO_BOOKMARKS_BEFORE, NO_MORE_BOOKMARKS } from "../vscode-bookmarks-core/src/api/bookmark";
import { Directions } from "../vscode-bookmarks-core/src/api/constants";
import { BookmarksController } from "../vscode-bookmarks-core/src/model/bookmarks";
import { Selection } from "../vscode-bookmarks-core/src/selection/selection";
import { BookmarkProvider, BookmarksExplorer } from "../vscode-bookmarks-core/src/sidebar/bookmarkProvider";
import { Parser, Point } from "../vscode-bookmarks-core/src/sidebar/parser";
import { Sticky } from "../vscode-bookmarks-core/src/sticky/sticky";
import { WhatsNewManager } from "../vscode-whats-new/src/Manager";
import { WhatsNewBookmarksContentProvider } from "./whats-new/BookmarksContentProvider";

/**
 * Define the Bookmark Decoration
 */
function createTextEditorDecoration(context: vscode.ExtensionContext) {

    let pathIcon: string = vscode.workspace.getConfiguration("bookmarks").get("gutterIconPath", "");
    if (pathIcon !== "") {
        if (!fs.existsSync(pathIcon)) {
            vscode.window.showErrorMessage('The file "' + pathIcon + '" used for "bookmarks.gutterIconPath" does not exists.');
            pathIcon = context.asAbsolutePath("images/bookmark.svg");
        }
    } else {
        pathIcon = context.asAbsolutePath("images/bookmark.svg");
    }
    
    const backgroundColor: string = vscode.workspace.getConfiguration("bookmarks").get("backgroundLineColor", "");

    const decorationOptions: vscode.DecorationRenderOptions = {
        gutterIconPath: pathIcon,
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        overviewRulerColor: "rgba(21, 126, 251, 0.7)"
    }

    if (backgroundColor) {
        decorationOptions.backgroundColor = backgroundColor;
        decorationOptions.isWholeLine = true;
    }

    return vscode.window.createTextEditorDecorationType(decorationOptions);
}

// this method is called when vs code is activated
export function activate(context: vscode.ExtensionContext) {
  
    let bookmarks: BookmarksController;
    let activeEditorCountLine: number;
    let timeout: NodeJS.Timer;

    const provider = new WhatsNewBookmarksContentProvider();
    const viewer = new WhatsNewManager(context).registerContentProvider("Bookmarks", provider);
    viewer.showPageInActivation();
    context.subscriptions.push(vscode.commands.registerCommand("bookmarks.whatsNew", () => viewer.showPage()));

    // load pre-saved bookmarks
    const didLoadBookmarks: boolean = loadWorkspaceState();

    // tree-view
    // const bookmarkProvider = new BookmarkProvider(bookmarks, context);
    // vscode.window.registerTreeDataProvider("bookmarksExplorer", bookmarkProvider);
    
    const bookmarkExplorer = new BookmarksExplorer(bookmarks, context);
    const bookmarkProvider = bookmarkExplorer.getProvider();
    
    // bookmarkProvider.showTreeView();

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(cfg => {
        // Allow change the gutterIcon or backgroundLineColor without reload
        if (cfg.affectsConfiguration("bookmarks.gutterIconPath") || cfg.affectsConfiguration("bookmarks.backgroundLineColor")) {
            if (bookmarkDecorationType) {
                bookmarkDecorationType.dispose();
            }

            bookmarkDecorationType = createTextEditorDecoration(context);
            context.subscriptions.push(bookmarkDecorationType);

            updateDecorations();
        }
    }));

    let bookmarkDecorationType = createTextEditorDecoration(context);
    context.subscriptions.push(bookmarkDecorationType);

    // Connect it to the Editors Events
    let activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
        if (!didLoadBookmarks) {
            bookmarks.add(activeEditor.document.uri.fsPath);
        }
        activeEditorCountLine = activeEditor.document.lineCount;
        bookmarks.activeBookmark = bookmarks.fromUri(activeEditor.document.uri.fsPath);
        triggerUpdateDecorations();
    }

    // new docs
    vscode.workspace.onDidOpenTextDocument(doc => {
        bookmarks.add(doc.uri.fsPath);
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            activeEditorCountLine = editor.document.lineCount;
            bookmarks.activeBookmark = bookmarks.fromUri(editor.document.uri.fsPath);
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
//            triggerUpdateDecorations();
            let updatedBookmark: boolean = false;

            // workaround for formatters like Prettier (#118)
            if (vscode.workspace.getConfiguration("bookmarks").get("useWorkaroundForFormatters", false)) {
                updateDecorations();
                return;
            }

            // call sticky function when the activeEditor is changed
            if (bookmarks.activeBookmark && bookmarks.activeBookmark.bookmarks.length > 0) {
                updatedBookmark = Sticky.stickyBookmarks(event, activeEditorCountLine, bookmarks.activeBookmark,
                activeEditor, bookmarks);
            }

            activeEditorCountLine = event.document.lineCount;
            updateDecorations();

            if (updatedBookmark) {
                saveWorkspaceState();
            }
        }
    }, null, context.subscriptions);

    // Timeout
    function triggerUpdateDecorations() {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(updateDecorations, 100);
    }

    // Evaluate (prepare the list) and DRAW
    function updateDecorations() {
        if (!activeEditor) {
            return;
        }

        if (!bookmarks.activeBookmark) {
            return;
        }

        if (bookmarks.activeBookmark.bookmarks.length === 0) {
            const bks: vscode.Range[] = [];
          
            activeEditor.setDecorations(bookmarkDecorationType, bks);
            return;
        }

        const books: vscode.Range[] = [];

        // Remove all bookmarks if active file is empty
        if (activeEditor.document.lineCount === 1 && activeEditor.document.lineAt(0).text === "") {
            bookmarks.activeBookmark.bookmarks = [];
        } else {
            const invalids = [];
            for (const element of bookmarks.activeBookmark.bookmarks) {

                if (element.line <= activeEditor.document.lineCount) { 
                    const decoration = new vscode.Range(element.line, 0, element.line, 0);
                    books.push(decoration);
                } else {
                    invalids.push(element);
                }
            }

            if (invalids.length > 0) {
                let idxInvalid: number;
                for (const element of invalids) {
                    idxInvalid = bookmarks.activeBookmark.indexOfBookmark(element); // bookmarks.indexOf(element); 
                    bookmarks.activeBookmark.bookmarks.splice(idxInvalid, 1);
                }
            }
        }
        activeEditor.setDecorations(bookmarkDecorationType, books);
    }

    vscode.commands.registerCommand("bookmarks.jumpTo", (documentPath, line, column: string) => {
        const uriDocBookmark: vscode.Uri = vscode.Uri.file(documentPath);
        vscode.workspace.openTextDocument(uriDocBookmark).then(doc => {
            vscode.window.showTextDocument(doc ).then(editor => {
                const lineInt: number = parseInt(line, 10);
                const colunnInt: number = parseInt(column, 10);
                // revealLine(lineInt - 1);
                revealPosition(lineInt - 1, colunnInt - 1);
            });
        });
    });

    vscode.commands.registerCommand("bookmarks.refresh", node => {
        bookmarkProvider.refresh();
    });

    vscode.commands.registerCommand("bookmarks.expandAll", node => {
        bookmarkExplorer.expandAll();
    });

    vscode.commands.registerCommand("bookmarks.clearFromFile", node => {
        bookmarks.clear(node.bookmark);
        saveWorkspaceState();
        updateDecorations();
    });

    vscode.commands.registerCommand("bookmarks.deleteBookmark", node => {
        const book: BookmarkedFile = bookmarks.fromUri(node.command.arguments[0]);
        const index = book.indexOfBookmark(node.command.arguments[1] - 1); // bookmarks.indexOf({line: node.command.arguments[1] - 1});
        bookmarks.removeBookmark(index, node.command.arguments[1] - 1, book);
        saveWorkspaceState();
        updateDecorations();
    });

    vscode.commands.registerCommand("bookmarks.editLabel", node => {
        const uriDocBookmark: vscode.Uri = vscode.Uri.file(node.command.arguments[0]);
        const book: BookmarkedFile = bookmarks.fromUri(uriDocBookmark.fsPath);
        const index = book.indexOfBookmark(node.command.arguments[1] - 1);

        const position: vscode.Position = new vscode.Position(node.command.arguments[1] - 1, 
            node.command.arguments[2] - 1);
        // book.bookmarks[index].label = "novo label";
        askForBookmarkLabel(index, position, book.bookmarks[index].label, false, book);
    });

    vscode.commands.registerCommand("bookmarks.clear", () => clear());
    vscode.commands.registerCommand("bookmarks.clearFromAllFiles", () => clearFromAllFiles());
    vscode.commands.registerCommand("bookmarks.selectLines", () => selectLines());
    vscode.commands.registerCommand("bookmarks.expandSelectionToNext", () => expandSelectionToNextBookmark(Directions.Forward));
    vscode.commands.registerCommand("bookmarks.expandSelectionToPrevious", () => expandSelectionToNextBookmark(Directions.Backward));
    vscode.commands.registerCommand("bookmarks.shrinkSelection", () => shrinkSelection());
    vscode.commands.registerCommand("bookmarks.toggle", () => toggle());
    vscode.commands.registerCommand("bookmarks.toggleLabeled", () => toggleLabeled());    
    vscode.commands.registerCommand("bookmarks.jumpToNext", () => jumpToNext());
    vscode.commands.registerCommand("bookmarks.jumpToPrevious", () => jumpToPrevious());
    vscode.commands.registerCommand("bookmarks.list", () => list());
    vscode.commands.registerCommand("bookmarks.listFromAllFiles", () => listFromAllFiles());
    
    function revealLine(line: number) {
        let reviewType: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter;
        if (line === vscode.window.activeTextEditor.selection.active.line) {
            reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
        }
        const newSe = new vscode.Selection(line, 0, line, 0);
        vscode.window.activeTextEditor.selection = newSe;
        vscode.window.activeTextEditor.revealRange(newSe, reviewType);
    }

    function revealPosition(line, column: number) {

        if (isNaN(column)) {
            revealLine(line);
        } else {
            let reviewType: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter;
            if (line === vscode.window.activeTextEditor.selection.active.line) {
                reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
            }
            const newSe = new vscode.Selection(line, column, line, column);
            vscode.window.activeTextEditor.selection = newSe;
            vscode.window.activeTextEditor.revealRange(newSe, reviewType);
        }
    }

    function canSaveBookmarksInProject(): boolean {
        let saveBookmarksInProject: boolean = vscode.workspace.getConfiguration("bookmarks").get("saveBookmarksInProject", false);
        
        // really use saveBookmarksInProject
        // 0. has at least a folder opened
        // 1. is a valid workspace/folder
        // 2. has only one workspaceFolder
        // let hasBookmarksFile: boolean = false;
        if (saveBookmarksInProject && ((!vscode.workspace.workspaceFolders) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1))) {
            // hasBookmarksFile = fs.existsSync(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, ".vscode", "bookmarks.json"));
            saveBookmarksInProject = false;
        }

        return saveBookmarksInProject;
    }

    function loadWorkspaceState(): boolean {
        const saveBookmarksInProject: boolean = canSaveBookmarksInProject();

        bookmarks = new BookmarksController("");

        if (saveBookmarksInProject) {
            if (!vscode.workspace.workspaceFolders) {
                return false;
            }

            const bookmarksFileInProject: string = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, ".vscode", "bookmarks.json");
            if (!fs.existsSync(bookmarksFileInProject)) {
                return false;
            }
            try {
                bookmarks.loadFrom(JSON.parse(fs.readFileSync(bookmarksFileInProject).toString()), true);
                return true;
            } catch (error) {
                vscode.window.showErrorMessage("Error loading Bookmarks: " + error.toString());
                return false;
            }
        } else {
            const savedBookmarks = context.workspaceState.get("bookmarks", "");
            if (savedBookmarks !== "") {
                bookmarks.loadFrom(JSON.parse(savedBookmarks));
            }
            return savedBookmarks !== "";
        }        
    }

    function saveWorkspaceState(): void {
        const saveBookmarksInProject: boolean = canSaveBookmarksInProject();
        // return;
        if (saveBookmarksInProject) {
            const bookmarksFileInProject: string = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, ".vscode", "bookmarks.json");

            // avoid empty bookmarks.json file
            if (!bookmarks.hasAnyBookmark()) {
                if (fs.existsSync(bookmarksFileInProject)) {
                    fs.unlinkSync(bookmarksFileInProject);
                }
                return;
            }

            if (!fs.existsSync(path.dirname(bookmarksFileInProject))) {
                fs.mkdirSync(path.dirname(bookmarksFileInProject)); 
            }
            fs.writeFileSync(bookmarksFileInProject, JSON.stringify(bookmarks.zip(true), null, "\t"));   
        } else {
            context.workspaceState.update("bookmarks", JSON.stringify(bookmarks.zip()));
        }
    }

    function removeBasePathFrom(aPath: string, currentWorkspaceFolder: vscode.WorkspaceFolder): string {
        if (!vscode.workspace.workspaceFolders) {
            return aPath;
        }
        
        let inWorkspace: vscode.WorkspaceFolder;
        for (const wf of vscode.workspace.workspaceFolders) {
            if (aPath.indexOf(wf.uri.fsPath) === 0) {
                inWorkspace = wf;
            }
        }

        if (inWorkspace) {
            if (inWorkspace === currentWorkspaceFolder) {
                return aPath.split(inWorkspace.uri.fsPath).pop();
            } else {
                if (!currentWorkspaceFolder && vscode.workspace.workspaceFolders.length === 1) {
                    return aPath.split(inWorkspace.uri.fsPath).pop();
                } else {
                    return "$(file-submodule) " + inWorkspace.name + /*path.sep + */aPath.split(inWorkspace.uri.fsPath).pop();
                }
            }
            // const base: string = inWorkspace.name ? inWorkspace.name : inWorkspace.uri.fsPath;
            // return path.join(base, aPath.split(inWorkspace.uri.fsPath).pop());
            // return aPath.split(inWorkspace.uri.fsPath).pop();
        } else {
            return "$(file-directory) " + aPath;
        }
    }

    //
    function list() {
        
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to list bookmarks");
          return;
        }
        
        // no active bookmark
        if (!bookmarks.activeBookmark) {
            vscode.window.showInformationMessage("No Bookmark found");
            return;  
        }
      
        // no bookmark
        if (bookmarks.activeBookmark.bookmarks.length === 0) {
            vscode.window.showInformationMessage("No Bookmark found");
            return;
        }

        // push the items
        const items: vscode.QuickPickItem[] = [];
        // tslint:disable-next-line:prefer-for-of
        for (let index = 0; index < bookmarks.activeBookmark.bookmarks.length; index++) {

            const bookmarkLine = bookmarks.activeBookmark.bookmarks[index].line + 1;
            const bookmarkColumn = bookmarks.activeBookmark.bookmarks[index].column + 1;
            const lineText = vscode.window.activeTextEditor.document.lineAt(bookmarkLine - 1).text.trim();

            if (bookmarks.activeBookmark.bookmarks[index].label === "") {
                items.push({ description: "(Ln " + bookmarkLine.toString() + ", Col " + 
                    bookmarkColumn.toString() + ")", label: lineText });
            } else {
                items.push({ description: "(Ln " + bookmarkLine.toString() + ", Col " + 
                bookmarkColumn.toString() + ")", 
                label: "$(tag) " + bookmarks.activeBookmark.bookmarks[index].label });
            }
        }

        // pick one
        const currentLine: number = vscode.window.activeTextEditor.selection.active.line + 1;
        const options = <vscode.QuickPickOptions> {
            placeHolder: "Type a line number or a piece of code to navigate to",
            matchOnDescription: true,
            // matchOnDetail: true,
            onDidSelectItem: item => {
                const itemT = <vscode.QuickPickItem> item;
                const point: Point = Parser.parsePosition(itemT.description);
                if (point) {
                    revealPosition(point.line - 1, point.column - 1);
                }
            }
        };

        vscode.window.showQuickPick(items, options).then(selection => {
            if (typeof selection === "undefined") {
                revealLine(currentLine - 1);
                return;
            }
            const itemT = <vscode.QuickPickItem> selection;
            const point: Point = Parser.parsePosition(itemT.description);
            if (point) {
                revealPosition(point.line - 1, point.column - 1);
            }
    });
    };

    function clear() {
        
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to clear bookmarks");
          return;
        }      
      
        bookmarks.clear();
        saveWorkspaceState();
        updateDecorations();
    };

    function clearFromAllFiles() {
        bookmarks.clearAll();
        saveWorkspaceState();
        updateDecorations();
    };

    function selectLines() {
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to clear bookmarks");
          return;
        }
        
        if (bookmarks.activeBookmark.bookmarks.length === 0) {
          vscode.window.showInformationMessage("No Bookmark found");
          return;
        }      

        const lines: number[] = [];
        for (const bookmark of bookmarks.activeBookmark.bookmarks) {
            lines.push(bookmark.line);
        }
        Selection.selectLines(vscode.window.activeTextEditor, lines);
    };   

    function shrinkSelection() {
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to shrink bookmark selection");
          return;
        }
        
        if (vscode.window.activeTextEditor.selections.length > 1) {
          vscode.window.showInformationMessage("Command not supported with more than one selection");
          return;
        }
        
        if (vscode.window.activeTextEditor.selection.isEmpty) {
          vscode.window.showInformationMessage("No selection found");
          return;
        }              
        
        if (bookmarks.activeBookmark.bookmarks.length === 0) {
          vscode.window.showInformationMessage("No Bookmark found");
          return;
        }      
      
        // which direction?
        const direction: Directions = vscode.window.activeTextEditor.selection.isReversed ? Directions.Forward : Directions.Backward;
        const activeSelectionStartLine: number = vscode.window.activeTextEditor.selection.isReversed ? vscode.window.activeTextEditor.selection.end.line : vscode.window.activeTextEditor.selection.start.line; 

        let currPosition: vscode.Position;
        if (direction === Directions.Forward) {
            currPosition = vscode.window.activeTextEditor.selection.start;
        } else {
            currPosition = vscode.window.activeTextEditor.selection.end;
        }
    
        bookmarks.activeBookmark.nextBookmark(currPosition, direction)
            .then((next) => {
              if (typeof next === "number") {
                    vscode.window.setStatusBarMessage("No more bookmarks", 2000);
                    return;
              } else {
                   
                  if ((direction === Directions.Backward && next.line < activeSelectionStartLine) || 
                    (direction === Directions.Forward && next.line > activeSelectionStartLine)) {
                      vscode.window.setStatusBarMessage("No more bookmarks to shrink", 2000);
                  } else {                  
                    Selection.shrinkRange(vscode.window.activeTextEditor, next, direction);
                  }
              }
            })
            .catch((error) => {
              console.log("activeBookmark.nextBookmark REJECT" + error);
            });        
    }
    
    function expandSelectionToNextBookmark(direction: Directions) {
        if (!vscode.window.activeTextEditor) {
            vscode.window.showInformationMessage("Open a file first to clear bookmarks");
            return;
        }

        if (bookmarks.activeBookmark.bookmarks.length === 0) {
            vscode.window.showInformationMessage("No Bookmark found");
            return;
        }

        if (bookmarks.activeBookmark.bookmarks.length === 1) {
            vscode.window.showInformationMessage("There is only one bookmark in this file");
            return;
        }

        let currPosition: vscode.Position;
        if (vscode.window.activeTextEditor.selection.isEmpty) {
            currPosition = vscode.window.activeTextEditor.selection.active;
        } else {
            if (direction === Directions.Forward) {
                currPosition = vscode.window.activeTextEditor.selection.end;
            } else {
                currPosition = vscode.window.activeTextEditor.selection.start;
            }
        }

        bookmarks.activeBookmark.nextBookmark(currPosition, direction)
            .then((next) => {
                if (typeof next === "number") {
                    vscode.window.setStatusBarMessage("No more bookmarks", 2000);
                    return;
                } else {
                    Selection.expandRange(vscode.window.activeTextEditor, next, direction);
                }
            })
            .catch((error) => {
                console.log("activeBookmark.nextBookmark REJECT" + error);
            });
    };

    function listFromAllFiles() {

        // no bookmark
        if (!bookmarks.hasAnyBookmark()) {
            vscode.window.showInformationMessage("No Bookmarks found");
            return;
        }

        // push the items
        const items: vscode.QuickPickItem[] = [];
        const activeTextEditorPath = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : "";
        const promisses = [];
        const currentLine: number = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line + 1 : -1;
        
        let currentWorkspaceFolder: vscode.WorkspaceFolder; 
        if (activeTextEditorPath) {
            currentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(activeTextEditorPath));
        }            
        
        // for (let index = 0; index < bookmarks.bookmarks.length; index++) {
        for (const bookmark of bookmarks.storage.fileList) {
            const pp = bookmark.listBookmarks();
            promisses.push(pp);
        }
        
        Promise.all(promisses).then(
          (values) => {
              
              for (const element of values) {
                  if (element) {
                    for (const elementInside of element) {
                        if (elementInside.detail.toString().toLowerCase() === activeTextEditorPath.toLowerCase()) {
                            items.push(
                                {
                                    label: elementInside.label,
                                    description: elementInside.description
                                }
                            );
                        } else {
                            const itemPath = removeBasePathFrom(elementInside.detail, currentWorkspaceFolder);
                            items.push(
                                {
                                    label: elementInside.label,
                                    description: elementInside.description,
                                    detail: itemPath
                                }
                            );
                        }
                    }

                  }

              }

              // sort
              // - active document
              // - no octicon - document in same workspaceFolder
              // - with octicon 'file-submodules' - document in another workspaceFolder
              // - with octicon - 'file-directory' - document outside any workspaceFolder
              let itemsSorted: vscode.QuickPickItem[];
              itemsSorted = items.sort(function(a: vscode.QuickPickItem, b: vscode.QuickPickItem): number {
                if (!a.detail && !b.detail) {
                    return 0;
                }
                
                if (!a.detail && b.detail) {
                    return -1;
                }
                
                if (a.detail && !b.detail) {
                    return 1;
                }
                
                if ((a.detail.toString().indexOf("$(file-submodule) ") === 0) && (b.detail.toString().indexOf("$(file-directory) ") === 0)) {
                    return -1;
                };
                
                if ((a.detail.toString().indexOf("$(file-directory) ") === 0) && (b.detail.toString().indexOf("$(file-submodule) ") === 0)) {
                    return 1;
                };
                
                if ((a.detail.toString().indexOf("$(file-submodule) ") === 0) && (b.detail.toString().indexOf("$(file-submodule) ") === -1)) {
                    return 1;
                };
                
                if ((a.detail.toString().indexOf("$(file-submodule) ") === -1) && (b.detail.toString().indexOf("$(file-submodule) ") === 0)) {
                    return -1;
                };
                
                if ((a.detail.toString().indexOf("$(file-directory) ") === 0) && (b.detail.toString().indexOf("$(file-directory) ") === -1)) {
                    return 1;
                };
                
                if ((a.detail.toString().indexOf("$(file-directory) ") === -1) && (b.detail.toString().indexOf("$(file-directory) ") === 0)) {
                    return -1;
                };
                
                return 0;
              });

              const options = <vscode.QuickPickOptions> {
                  placeHolder: "Type a line number or a piece of code to navigate to",
                  matchOnDescription: true,
                  onDidSelectItem: item => {

                      const itemT = <vscode.QuickPickItem> item;

                      let filePath: string;
                      // no detail - previously active document
                      if (!itemT.detail) {
                          filePath = activeTextEditorPath;
                      } else {
                          // with octicon - document outside project
                          if (itemT.detail.toString().indexOf("$(file-directory) ") === 0) {
                              filePath = itemT.detail.toString().split("$(file-directory) ").pop();
                          } else { // with octicon - documento from other workspaceFolder
                            if (itemT.detail.toString().indexOf("$(file-submodule)") === 0) {
                                filePath = itemT.detail.toString().split("$(file-submodule) ").pop();
                                for (const wf of vscode.workspace.workspaceFolders) {
                                    if (wf.name === filePath.split(path.sep).shift()) {
                                        filePath = path.join(wf.uri.fsPath, filePath.split(path.sep).slice(1).join(path.sep));
                                        break;
                                    }
                                }
                                
                            } else { // no octicon - document inside project
                                if (currentWorkspaceFolder) {
                                    filePath = currentWorkspaceFolder.uri.fsPath + itemT.detail.toString();
                                } else {
                                    if (vscode.workspace.workspaceFolders) {
                                        filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + itemT.detail.toString();
                                    } else {
                                        filePath = itemT.detail.toString();
                                    }
                                }
                            }
                          }
                      }

                      const point: Point = Parser.parsePosition(itemT.description);
                      if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase() === filePath.toLowerCase()) {
                        if (point) {
                            revealPosition(point.line - 1, point.column - 1);
                        }
                      } else {
                          const uriDocument: vscode.Uri = vscode.Uri.file(filePath);
                          vscode.workspace.openTextDocument(uriDocument).then(doc => {
                              vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true }).then(editor => {
                                if (point) {
                                    revealPosition(point.line - 1, point.column - 1);
                                }
                              });
                          });
                      }
                  }
              };
              vscode.window.showQuickPick(itemsSorted, options).then(selection => {
                  if (typeof selection === "undefined") {
                      if (activeTextEditorPath === "")  {
                          return;
                      } else {
                        const uriDocument: vscode.Uri = vscode.Uri.file(activeTextEditorPath);
                        vscode.workspace.openTextDocument(uriDocument).then(doc => {
                            vscode.window.showTextDocument(doc).then(editor => {
                                revealLine(currentLine - 1);
                                return;
                            });
                        });                          
                      }
                  }
                  
                  if (typeof selection === "undefined") {
                      return;
                  }

                  const point: Point = Parser.parsePosition(selection.description);
                  if (!selection.detail) {
                    if (point) {
                        revealPosition(point.line - 1, point.column - 1);
                    }
                  } else {
                      let newPath: string;
                      // with octicon - document outside project
                      if (selection.detail.toString().indexOf("$(file-directory) ") === 0) {
                          newPath = selection.detail.toString().split("$(file-directory) ").pop();
                      } else {// no octicon - document inside project
                        if (selection.detail.toString().indexOf("$(file-submodule)") === 0) {
                            newPath = selection.detail.toString().split("$(file-submodule) ").pop();
                            for (const wf of vscode.workspace.workspaceFolders) {
                                if (wf.name === newPath.split(path.sep).shift()) {
                                    newPath = path.join(wf.uri.fsPath, newPath.split(path.sep).slice(1).join(path.sep));
                                    break;
                                }
                            }                            
                        } else { // no octicon - document inside project
                            if (currentWorkspaceFolder) {
                                newPath = currentWorkspaceFolder.uri.fsPath + selection.detail.toString();
                            } else {
                                if (vscode.workspace.workspaceFolders) {
                                    newPath = vscode.workspace.workspaceFolders[0].uri.fsPath + selection.detail.toString();
                                } else {
                                    newPath = selection.detail.toString();
                                }
                            }
                        }
                      }
                      const uriDocument: vscode.Uri = vscode.Uri.file(newPath);
                      vscode.workspace.openTextDocument(uriDocument).then(doc => {
                          vscode.window.showTextDocument(doc).then(editor => {
                            if (point) {
                                revealPosition(point.line - 1, point.column - 1);
                            }        
                          });
                      });
                  }
              });
            }  
        );
    };

    function jumpToNext() {
        
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to jump to bookmarks");
          return;
        }
        
        if (!bookmarks.activeBookmark) {
            return;
        }      
        
        // 
        bookmarks.activeBookmark.nextBookmark(vscode.window.activeTextEditor.selection.active)
            .then((next) => {
              if (typeof next === "number") {

                if (!checkBookmarks(next)) {
                    return;
                }

                bookmarks.nextDocumentWithBookmarks(bookmarks.activeBookmark)
                  .then((nextDocument) => {
                      
                      if (nextDocument === NO_MORE_BOOKMARKS) {
                        return;
                      }

                      // same document?
                      const activeDocument = BookmarksController.normalize(vscode.window.activeTextEditor.document.uri.fsPath);
                      if (nextDocument.toString() === activeDocument) {
                        revealPosition(bookmarks.activeBookmark.bookmarks[0].line, 
                            bookmarks.activeBookmark.bookmarks[0].column);
                      } else { 
                        vscode.workspace.openTextDocument(nextDocument.toString()).then(doc => {
                            vscode.window.showTextDocument(doc).then(editor => {
                                revealPosition(bookmarks.activeBookmark.bookmarks[0].line, 
                                    bookmarks.activeBookmark.bookmarks[0].column);
                            });
                        });
                      }
                  })
                  .catch(checkBookmarks);
              } else {
                  revealPosition(next.line, next.character);
              }
            })
            .catch((error) => {
              console.log("activeBookmark.nextBookmark REJECT" + error);
            });
    };

    function jumpToPrevious() {
      
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to jump to bookmarks");
          return;
        }
      
        if (!bookmarks.activeBookmark) {
            return;
        }      
        
        // 
        bookmarks.activeBookmark.nextBookmark(vscode.window.activeTextEditor.selection.active, Directions.Backward)
            .then((next) => {

                if (!checkBookmarks(next)) {
                    return;
                }

                if (typeof next === "number") {
                bookmarks.nextDocumentWithBookmarks(bookmarks.activeBookmark, Directions.Backward)
                  .then((nextDocument) => {
                      
                      if (nextDocument === NO_MORE_BOOKMARKS) {
                          return;
                      }
                    
                      // same document?
                      const activeDocument = BookmarksController.normalize(vscode.window.activeTextEditor.document.uri.fsPath);
                      if (nextDocument.toString() === activeDocument) {
                        revealPosition(bookmarks.activeBookmark.bookmarks[bookmarks.activeBookmark.bookmarks.length - 1].line, 
                            bookmarks.activeBookmark.bookmarks[bookmarks.activeBookmark.bookmarks.length - 1].column);
                      } else { 
                        vscode.workspace.openTextDocument(nextDocument.toString()).then(doc => {
                            vscode.window.showTextDocument(doc).then(editor => {
                                revealPosition(bookmarks.activeBookmark.bookmarks[bookmarks.activeBookmark.bookmarks.length - 1].line, 
                                    bookmarks.activeBookmark.bookmarks[bookmarks.activeBookmark.bookmarks.length - 1].column);
                            });
                        });
                      }
                  })
                  .catch(checkBookmarks);
              } else {
                  revealPosition(next.line, next.character);
              }
            })
            .catch((error) => {
              console.log("activeBookmark.nextBookmark REJECT" + error);
            });
    };

    function checkBookmarks(result: number | vscode.Position): boolean {
        if (result === NO_BOOKMARKS_BEFORE || result === NO_BOOKMARKS_AFTER) {
            vscode.window.showInformationMessage("No more bookmarks");
            return false;
        }
        return true;
    }

    function askForBookmarkLabel(index: number, position: vscode.Position, oldLabel?: string, jumpToPosition?: boolean,
                                 book?: BookmarkedFile) {
        const ibo = <vscode.InputBoxOptions> {
            prompt: "Bookmark Label",
            placeHolder: "Type a label for your bookmark",
            value: oldLabel
        };
        vscode.window.showInputBox(ibo).then(bookmarkLabel => {
            if (typeof bookmarkLabel === "undefined") {
                return;
            }
            // 'empty'
            if (bookmarkLabel === "" && (oldLabel === "" || jumpToPosition)) {
                vscode.window.showWarningMessage("You must define a label for the bookmark.");
                return;
            }
            if (index >= 0) {
                bookmarks.removeBookmark(index, position.line, book);
            }
            bookmarks.addBookmark(position, bookmarkLabel, book);
            
            // toggle editing mode
            if (jumpToPosition) {
                vscode.window.showTextDocument(vscode.window.activeTextEditor.document, { preview: false, viewColumn: vscode.window.activeTextEditor.viewColumn });
            }
            // sorted
            /* let itemsSorted = [] =*/
            const b: BookmarkedFile = book ? book : bookmarks.activeBookmark;
            b.bookmarks.sort((n1, n2) => {
                if (n1.line > n2.line) {
                    return 1;
                }
                if (n1.line < n2.line) {
                    return -1;
                }
                return 0;
            });
            saveWorkspaceState();
            updateDecorations();
        });
    }

    function toggle() {
        if (!vscode.window.activeTextEditor) {
          vscode.window.showInformationMessage("Open a file first to toggle bookmarks");
          return;
        }         
      
        const position = vscode.window.activeTextEditor.selection.active;

        // fix issue emptyAtLaunch
        if (!bookmarks.activeBookmark) {
            bookmarks.add(vscode.window.activeTextEditor.document.uri.fsPath);
            bookmarks.activeBookmark = bookmarks.fromUri(vscode.window.activeTextEditor.document.uri.fsPath);
        }

        const index = bookmarks.activeBookmark.indexOfBookmark(position.line);
        if (index < 0) {
            bookmarks.addBookmark(position);            
            vscode.window.showTextDocument(vscode.window.activeTextEditor.document, {preview: false, viewColumn: vscode.window.activeTextEditor.viewColumn} );
        } else {
            bookmarks.removeBookmark(index, position.line);
        }		

        // sorted
        /* let itemsSorted = [] =*/
        bookmarks.activeBookmark.bookmarks.sort((n1, n2) => {
            if (n1.line > n2.line) {
                return 1;
            }

            if (n1.line < n2.line) {
                return -1;
            }

            return 0;
        });

        saveWorkspaceState();
        updateDecorations();
    };

    function toggleLabeled() {

        if (!vscode.window.activeTextEditor) {
            vscode.window.showInformationMessage("Open a file first to toggle bookmarks");
            return;
        }

        const position: vscode.Position = vscode.window.activeTextEditor.selection.active;

        // fix issue emptyAtLaunch
        if (!bookmarks.activeBookmark) {
            bookmarks.add(vscode.window.activeTextEditor.document.uri.fsPath);
            bookmarks.activeBookmark = bookmarks.fromUri(vscode.window.activeTextEditor.document.uri.fsPath);
        }

        const index = bookmarks.activeBookmark.indexOfBookmark(position.line);
        const oldLabel: string = index > -1 ? bookmarks.activeBookmark.bookmarks[index].label : "";
        if (index < 0) {
            askForBookmarkLabel(index, position, undefined, true);
        } else {
            askForBookmarkLabel(index, position, oldLabel);
        }
    };
}