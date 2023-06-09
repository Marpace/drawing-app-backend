const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {cors: {origin: "*"}});

const { makeId } = require("./utils");
const wordsModule = require("./words-data")
const wordsDatabase = wordsModule.words

const socketRooms = {};
const rooms = {};

let chooseWordTimerInterval;
let chooseWordTimerCount;

let drawingTimerInterval;
let drawingTimerCount;

let wordOptions = [];
let paths = [];

const port = process.env.PORT || 5000
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());


io.on("connection", (socket) => {

  console.log(`client: ${socket.id} has connected`)

  socket.on("createGame", handleCreateGame);
  socket.on("validateCode", handleValidateCode)
  socket.on("joinGame", handleJoinGame);
  socket.on("playerReady", handlePlayerReady);
  socket.on("startGame", handleStartGame)

  socket.on("drawing", handleDrawing)
  socket.on("clearCanvas", handleClearCanvas);
  socket.on("undo", handleUndo);
  socket.on("updatePaths", handleUpdatePaths);

  socket.on("getWords", handleGetWords);
  socket.on("wordChosen", handleWordChosen);
  socket.on("newGuess", handleNewGuess);


  function handleCreateGame(data) {
    let roomCode = makeId(5);
    socketRooms[socket.id] = roomCode;
    rooms[roomCode] = {
      playerCount: 1, 
      players: [
        {
          username: data.username,
          avatarUrl: data.avatarUrl,
          admin: true,
          playerId: socket.id,
          ready: false,
          score: 0,
          guessedCorrectly: false,
          isCurrentPlayer: true,
          hasDrawn: false,
          isWinner: false
        }
      ],
      currentWord: null,
      roundsPlayed: 0,
      drawingTime: null,
      gameOver: true
    }; 
    socket.join(roomCode)
    socket.emit("createGameResponse", rooms[roomCode].players)
    socket.emit("isAdmin", roomCode);
  }

  function handleValidateCode(code) {
    let data = {
      isValid: false,
      message: ""
    };
    if(code === "") {
      data.message = "Please enter a game code";
    } 
    else if(!rooms[code]) {
      data.message = "Room code is invalid!";
    } 
    else if(rooms[code].playerCount >= 8) {
      data.message = "Room is full!";
    } 
    else {
      data = {
        isValid: true,
        message: "",
        code: code
      }
    }
    socket.emit("validateCodeResponse", data)
  }

  function handleJoinGame(data) {
    const room = data.code;
    if(!rooms[room]) return;

    socket.join(room);
    socketRooms[socket.id] = room;

    rooms[room].playerCount++
    rooms[room].players.push(
      {
      username: data.username,
      avatarUrl: data.avatarUrl,
      admin: false,  
      playerId: socket.id,
      ready: false,
      score: 0,
      guessedCorrectly: false,
      isCurrentPlayer: false,
      hasDrawn: false, 
      isWinner: false
      }
    )
    io.in(room)
    .emit("joinGameResponse", rooms[room].players)
  }

  function handlePlayerReady(avatarUrl) {
    const room = socketRooms[socket.id]
    if(!room) {
      console.log("cannot find room!")
      return;
    }

    const playerIndex = rooms[room].players.findIndex(player => player.avatarUrl === avatarUrl)

    rooms[room].players[playerIndex].ready = true

    io.in(room).emit("playerReadyResponse", rooms[room].players)
  }

  function handleStartGame(roundDuration) {
    const roomCode = socketRooms[socket.id];
    const adminPlayer = rooms[roomCode].players.find(player => player.admin === true);
    adminPlayer.isCurrentPlayer = true;
    rooms[roomCode].drawingTime = Number(roundDuration.match(/\d/g).join(""));

    rooms[roomCode].gameOver = false;
    startChooseWordTimer(roomCode)

    const data = {
      player: adminPlayer,
      playerCount: rooms[roomCode].playerCount
    }

    io.in(roomCode).emit("startGameResponse", data);
    io.to(adminPlayer.playerId).emit("currentPlayer");
  }

  function handleDrawing(data) {
    const room = socketRooms[socket.id];
    socket.to(room).emit("drawingResponse", data)
  }

  function handleClearCanvas() {
    const roomCode = socketRooms[socket.id];
    io.in(roomCode).emit("clearCanvasResponse");
  }

  function handleUndo() {
    if(paths.length <= 0) return;
    const roomCode = socketRooms[socket.id];
    paths.splice(-1, 1)
    io.in(roomCode).emit("undoResponse", paths)
  }

  function handleUpdatePaths(newPath) {
    paths.push(newPath)
  }

  function handleGetWords() {
    wordOptions = [];
    for(let i = 0; i <= 3; i++) {
      const randomWord = wordsDatabase[Math.floor(Math.random() * wordsDatabase.length - 1)];
      if(wordOptions.includes(randomWord)) i-- 
      else wordOptions.push(randomWord)
    }
    socket.emit("getWordsResponse", wordOptions)
  }

  function handleWordChosen(word) {
    const roomCode = socketRooms[socket.id];
    rooms[roomCode].currentWord = word.toLowerCase();
    clearInterval(chooseWordTimerInterval)
    io.in(roomCode).emit("wordChosenResponse", word)
    startDrawingTimer(roomCode);
    wordOptions = [];
  }

  function handleNewGuess(guessedWord) {
    const roomCode = socketRooms[socket.id];
    const room = rooms[roomCode];
    const playerGuessing = room.players.find(player => player.playerId === socket.id)
    const currentWord = room.currentWord.toLowerCase();
    const currentPlayer = room.players.find(player => player.isCurrentPlayer === true)
    
    if(!room) {
      console.log("Cannot find room")
      return;
    }
   
    //points are assigned according to how many players
    //have already guessed correctly
    let points = room.playerCount * 10 - 10;
    room.players.forEach( player => {
      if(player.guessedCorrectly) {
       points -= 10;
      }
    }); 

    const data = {
      content: guessedWord,
      author: playerGuessing.username,
      guessedCorrectly: false
    }

    //checking if player who is guessing has guessed correctly
    if(guessedWord.trim().toLowerCase() === currentWord) {
      console.log("player guessed correctly")
      if(!playerGuessing.correctGuesses) {
        playerGuessing.guessedCorrectly = true;
        playerGuessing.score += points;
        currentPlayer.score += 10;
      }
      data.guessedCorrectly = true;
      io.to(playerGuessing.playerId).emit("guessedCorrectly") 
    }
    io.in(roomCode).emit("newGuessResponse", data)
    io.in(roomCode).emit("updateGamePlayers", room.players)
    
    
    //checking if all the players have guessed the word and if so, ending the round
    const correctGuesses = room.players.filter( player => player.guessedCorrectly === true).length
    if( correctGuesses === room.playerCount - 1) roundOver(roomCode, false)

  } 


  // timer functions 
  function startChooseWordTimer() {
    chooseWordTimerCount = 20;
    chooseWordTimerInterval = setInterval(() => {
      chooseWordTimerCount-- 
      if(chooseWordTimerCount <= 0  && wordOptions.length > 0) {
        const chosenWord = wordOptions[Math.floor(Math.random() * 3)].word
        handleWordChosen(chosenWord);
      }
    }, 1000)
  }

  function startDrawingTimer(roomCode) {
    paths = [];
    drawingTimerCount = rooms[roomCode].drawingTime;
    drawingTimerInterval = setInterval(() => {
      drawingTimerCount--;
      if(drawingTimerCount <= 0) roundOver(roomCode, false);
    }, 1000)
  }

  // When a round or the game end 
  function roundOver(roomCode, playerDisconnected) {
    clearInterval(drawingTimerInterval);
    console.log("round over");
    const room = rooms[roomCode]
    const currentPlayer = room.players.find(player => player.isCurrentPlayer === true);
    if(!currentPlayer) {
      console.log("Something went wrong. Could not find current player");
      return;
    }
      
    //resetting values for next round and updating scores
    currentPlayer.hasDrawn = true;
    currentPlayer.isCurrentPlayer = false;
    room.roundsPlayed++;
    room.currentWord = null;
    room.players.forEach(player => player.guessedCorrectly = false);

    //choosing the next player to draw
    const newCurrentPlayer = rooms[roomCode].players.find(player => player.hasDrawn === false);
    
    const data = {
      players: room.players,
      gameOver: false,
      winningPlayer: room.players.sort((a, b) => b.score - a.score)[0],
      playerDisconnected: playerDisconnected
    }

    // checking if all the players have played their turn, thus game over
    if(!newCurrentPlayer || room.playerCount <= 1) {
      data.gameOver = true;
      data.winningPlayer.isWinner = true;
      io.in(roomCode).emit("roundOver", data);

      //10 second timeout to view standings before going back to game lobby
      setTimeout(() => {
        gameOver(roomCode);
      }, 10000)
    } 
    else {
      io.in(roomCode).emit("roundOver", data);

      //10 second timeout to view standings before starting next round
      setTimeout(() => {
        newCurrentPlayer.isCurrentPlayer = true;
        const startGameData = {
          player: newCurrentPlayer,
          playerCount: room.playerCount
        }
        io.in(roomCode).emit("startGameResponse", startGameData);
        io.to(newCurrentPlayer.playerId).emit("currentPlayer", newCurrentPlayer)
        startChooseWordTimer(roomCode)
      }, 10000);
    }
    io.in(roomCode).emit("clearCanvasResponse");
  }

  function gameOver(roomCode) {
    //reset all values
    const room = rooms[roomCode];
    room.currentWord = null;
    room.roundsPlayed = 0;
    room.players.forEach(player => {
      player.hasDrawn = false;
      player.score = 0;
      player.ready = false
    })

    io.in(roomCode).emit("gameOver", room.players)
  }

  //When the user navigates away from the page
  socket.on("disconnect", () => {
    console.log(`client: ${socket.id} has disconnected`)
    const roomCode = socketRooms[socket.id];
    const room = rooms[roomCode];
    if(!room ) return;
    const disconnectedPlayer = room.players.find(player => player.playerId === socket.id)
    if(!disconnectedPlayer) return;
    
    room.playerCount--;
    
    if(disconnectedPlayer.isCurrentPlayer) roundOver(roomCode, true);
    
    room.players.splice(room.players.indexOf(disconnectedPlayer), 1);
    

    if(disconnectedPlayer.admin && room.players.length >= 1) {
      console.log(room.players)
      const newAdmin = room.players.find(player => player.admin === false);
      newAdmin.admin = true;
      io.to(newAdmin.playerId).emit("isAdmin", roomCode)
    }
    io.to(roomCode).emit("playerDisconnected", room.players)
  })

})

server.listen(port, () => {
  console.log('listening on port: 5000');
});








// TODO
// Fix options for new admin player, when admin player is disconnected 
// come up with a name for the game
// add hint