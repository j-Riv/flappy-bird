import React from "react";
import { StyleSheet, View } from "react-native";
import Files from "./Files";
import * as THREE from "three"; // 0.88.0
import "three"; // Supported builtin module
import Expo from "expo";
import { Group, Node, Sprite, SpriteView } from "./GameKit";
import { Text } from 'react-native';

const SPEED = 1.6;
const GRAVITY = 1100;
const FLAP = 320;
const SPAWN_RATE = 2600;
const OPENING = 120;
const GROUND_HEIGHT = 64;

export default class Game extends React.Component {
  scale = 1;
  // Group of nodes that will be the parent to all of the pipe nodes
  pipes = new Group();
  // These will hold all of the pipes that have moved off screen.
  // We save reference to these so we can recycle them and save memory
  deadPipeTops = [];
  deadPipeBottoms = [];

  gameStarted = false;
  gameOver = false;
  velocity = 0;

  // Define the components state and give it a property 'score' then assign 'score' to 0
  state = {
    score: 0
  };

  // Because loading audio isn't dependent on a GL View, we can load it asap.
  componentWillMount() {
    //THREE.suppressExpoWarnings(true);
    this.setupAudio();
  }

  setupAudio = async () => {
    // Here we define how audio is used in our app.
    Expo.Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      interruptionModeIOS: Expo.Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: Expo.Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
    });

    // Now we parse the preloaded audio assets and create a helper object for playing sounds.
    this.audio = {};
    Object.keys(Files.audio).map(async key => {
      const res = Files.audio[key];
      const { sound } = await Expo.Audio.Sound.create(res);
      await sound.setStatusAsync({
        volume: 1,
      });
      this.audio[key] = async () => {
        try {
          await sound.setPositionAsync(0);
          await sound.playAsync();
        } catch (error) {
          console.warn('sound error', { error });
          // An error occurred!
        }
      };
    });
  };

  // Sprites
  setupPlayer = async () => {
    // Lets create the players display size. If you look at our player sprite
    // in assets/sprites/bird.png you will notice that there are three birds on it!
    // When we make an animation in a video game we load in a sprite sheet, which
    // is an optimal image containing all of the frames of an animation. Our display
    // size is the image size but the width is divided by the number of birds,
    // so 108 / 3 = 36 :)
    const size = {
      width: 36 * this.scale,
      height: 26 * this.scale
    };

    // Make a Sprite just like before but this time we will add a few more properties for animating.
    // tilesHoriz: (Tiles Horizontal) is how many tiles we have across (in our case 3).
    // tilesVert: (Tiles Vertical) is how many tiles we have... vertically ;) (in our case 1).
    // numTiles: The number of tiles in total
    // tilesDispDuration: How long each tile is on screen for before it goes to the next one, this is measured in milliseconds.
    // size: this is the size we defined earlier.
    const sprite = new Sprite();
    await sprite.setup({
      image: Files.sprites.bird,
      tilesHoriz: 3,
      tilesVert: 1,
      numTiles: 3,
      tileDispDuration: 75,
      size,
    });

    // Finally make a Node, give it our animated Sprite, and add it to the scene!
    this.player = new Node({
      sprite
    });
    this.scene.add(this.player);
  };

  setupGround = async () => {
    const { scene } = this;
    const size = {
      width: scene.size.width,
      height: scene.size.width * 0.333333333
    };
    this.groundNode = new Group();

    // Notice that we build two copies of the ground. Once one floor goes off
    // screen we place it to the back and taht creates our floor loop!
    const node = await this.setupStaticNode({
      image: Files.sprites.ground,
      size,
      name: "ground"
    });

    const nodeB = await this.setupStaticNode({
      image: Files.sprites.ground,
      size,
      name: 'ground',
    });
    nodeB.x = size.width;

    this.groundNode.add(node);
    this.groundNode.add(nodeB);

    // Set the groundNode group's position to be at teh bottom of the scene.
    this.groundNode.position.y = (scene.size.height + (size.height - GROUND_HEIGHT)) * -0.5;

    // Save a reference to the top of the ground for collision purposes. Then
    // move the ground slightly forward on the z-axis so that it appears in front
    // of the pipes.
    this.groundNode.top = this.groundNode.position.y + size.height / 2;

    this.groundNode.position.z = 0.01;
    scene.add(this.groundNode);
  };

  setupBackground = async () => {
    // Pull ina reference to the scene and get the scene's size
    const { scene } = this;
    const { size } = scene;
    // Call our helper function setupStaticNode and pass it our background
    // image, the size of the scene, and a cool name for referencing!
    const bg = await this.setupStaticNode({
      image: Files.sprites.bg,
      size,
      name: 'bg',
    });
    // Finally add the background node to our scene
    scene.add(bg);
  };

  // This function will determine if we should build a pipe or
  // if we have one that we can recycle
  setupPipe = async ({ key, y }) => {
    const size = {
      width: 52,
      height: 320,
    };
    // Define a dictionary for our images
    const tbs = {
      top: Files.sprites.pipe_top,
      bottom: Files.sprites.pipe_bottom,
    };
    const pipe = await this.setupStaticNode({
      image: tbs[key],
      size,
      name: key,
    });
    // Give the pipe a reference to it's size
    // pipe.size = size;
    pipe.y = y;

    return pipe;
  };

  setupStaticNode = async({ image, size, name, scale }) => {
    scale = scale || this.scale;
    // Create a new Sprite from our GameKit and give it a image, and a size
    const sprite = new Sprite();

    await sprite.setup({
      image,
      size: {
        width: size.width * scale,
        height: size.height * scale,
      }
    });

    // Now we create a Node with our Sprite and we give it a name for reference!
    const node = new Node({
      sprite,
    });
    node.name = name;
    return node;
  };

  spawnPipe = async (openPos, flipped) => {
    // First we want to get a random position for our pipes
    let pipeY;
    if(flipped){
      pipeY = Math.floor(openPos - OPENING / 2 - 320);
    }else{
      pipeY = Math.floor(openPos + OPENING / 2);
    }
    // Next we define if it's a top or bottom pipe
    let pipeKey = flipped ? 'bottom' : 'top';
    let pipe;
    // Here we set the initial x position for the pipe
    // - this is just offscreen ot the right
    const end = this.scene.bounds.right + 26;
    // Now we check if there are any offscreen pipes rthat we can just reposition
    if(this.deadPipeTops.length > 0 && pipeKey === 'top'){
      pipe = this.deadPipeTops.pop().revive();
      pipe.reset(end, pipeY);
    }else if(this.deadPipeBottoms.length > 0 && pipeKey === 'bottom'){
      pipe = this.deadPipeBottoms.pop().revive();
      pipe.reset(end, pipeY);
    }else{
      // If there aren't any pipes to recycle then we will create some and
      // add them to the pipes group.
      pipe = await this.setupPipe({
        y: pipeY,
        key: pipeKey,
      });
      pipe.x = end;
      this.pipes.add(pipe);
    }
    // Set the pipes velocity so it knows how fast to go
    pipe.velocity = -SPEED;
    return pipe;
  };

  // This function will choose the random position for the pipes
  // and spawn them right off screen
  spawnPipes = () => {
    this.pipes.forEachAlive(pipe => {
      // If any pipes are fof screen then we want to flag them as "dead"
      // so we can reccyle them!
      if(pipe.size && pipe.x + pipe.size.width < this.scene.bounds.left) {
        if(pipe.name === 'top'){
          this.deadPipeTops.push(pipe.kill());
        }
        if(pipe.name === 'bottom'){
          this.deadPipeBottoms.push(pipe.kill());
        }
      }
    });
    // Get a random spot for the center of the two pipes.
    const pipeY =
      this.scene.size.height / 2 +
      (Math.random() - 0.5) * this.scene.size.height * 0.2;
    // Spawn both pipes around this point.
    this.spawnPipe(pipeY);
    this.spawnPipe(pipeY, true);
  };

  tap = () => {
    // On the first tap we start the game
    if(!this.gameStarted){
      this.gameStarted = true;
      // Here we build a timer to spawn the pipes
      this.pillarInterval = setInterval(this.spawnPipes, SPAWN_RATE);
    }
    if(!this.gameOver){
      // If the game hasn't ended yet then we should set our players velocity
      // to a constant velociy we defined earlier.
      this.velocity = FLAP;
      this.audio.wing();
    }else{
      // If the game has ended then we should reset it.
      this.reset();
    }
  };

  // Let's build a helpful function to increment the score by 1 whenever it's called.
  addScore = () => {
    this.setState({ score: this.state.score + 1 });
    this.audio.point();
  };

  setGameOver = () => {
    // Toggle the gameOver flag to true, then stop the pipes from continuing to spawn.
    this.gameOver = true;
    clearInterval(this.pillarInterval);
    this.audio.hit();
  };

  // This method has all of the necessary resets to rever the game to the initial state.
  // - We set the flags to false
  // - Set the score to 0
  // - Reset the player position / angle
  // - Remove all of the pipe nodes
  reset = () => {
    this.gameStarted = false;
    this.gameOver = false;
    this.setState({ score: 0 });

    this.player.reset(this.scene.size.width * -0.3, 0);
    this.player.angle = 0;
    this.pipes.removeAll();
  };

  onSetup = async ({ scene }) => {
    // Give us a global reference to the scene
    this.scene = scene;
    this.scene.add(this.pipes);
    await this.setupBackground();
    // Add this function before we add the pipes to the scene.
    await this.setupGround();
    await this.setupPlayer();
    // We call reset after we finish setting up the scene, this allows us
    // to keep a consistent state.
    this.reset();
  };

  updateGame = delta => {
    if(this.gameStarted) {
      // If the game has started then we want to add gravity * delta to our velocity.
      this.velocity -= GRAVITY * delta;
      const target = this.groundNode.top;
      if(!this.gameOver) {
        // Get the collision box for our bird.
        const playerBox = new THREE.Box3().setFromObject(this.player);
        // Here we iterate over all of the active pipes and move them to the left.
        this.pipes.forEachAlive(pipe => {
          pipe.x += pipe.velocity;
          // Define the collision box for a pipe.
          const pipeBox = new THREE.Box3().setFromObject(pipe);
          // We check if the user collided with any of the pipes.
          // If so then we ned the game.
          if (pipeBox.intersectsBox(playerBox)) {
            this.setGameOver();
          }
          // We check to see if a user has passed a pipe, if so then we update the score!
          if(pipe.name === 'bottom' && !pipe.passed && pipe.x < this.player.x){
            pipe.passed = true;
            this.addScore();
          }
        });
        // this moved inside !this.gameOver
        // Here we set the birds rotation (in radians). Notice how we clamp it width
        // min/max. This way when the bird has upwards velocity it spins to point up,
        // and the opposite happens when it's falling down.
        this.player.angle = Math.min(
          Math.PI / 4,
          Math.max(-Math.PI / 2, (FLAP + this.velocity) / FLAP)
        );
        // Check to see if the user's y position is lower than the floor, if so
        // then we end the game.
        if (this.player.y <= target) {
          this.setGameOver();
        }
        // Let's add another instance of updating the bird's flapping animation
        // when we are playing the game.
        this.player.update(delta);
      }
      // If the game is over than let the player continue to fall until they hit the floor.
      if(this.player.y <= target) {
        this.player.angle = -Math.PI / 2;
        this.player.y = target;
        this.velocity = 0;
      }else{
        // Apply velocity to our bird's position.
        this.player.y += this.velocity * delta;
      }
    }else{
      // This is the dope bobbing bird animation before we start. Notice the cool use of Math.cos
      this.player.update(delta);
      this.player.y = 8 * Math.cos(Date.now() / 200);
      this.player.angle = 0;
    }
    // Only move the floor while the player is alive.
    if(!this.gameOver) {
      //@(Evan Bacon) This is where we do the floor looping animation
      this.groundNode.children.map((node, index) => {
        // Move the floor at the same speed as the rest of the world.
        node.x -= SPEED;
        // If the child ground node is off screen then get the next child ground
        // node on the screen.
        if (node.x < this.scene.size.width * -1) {
          let nextIndex = index + 1;
          if (nextIndex === this.groundNode.children.length) {
            nextIndex = 0;
          }
          const nextNode = this.groundNode.children[nextIndex];
          // Get the position of the last node and move the current node behind it.
          node.x = nextNode.x + this.scene.size.width - 1.55;
        }
      });
    }
  };

  // Here we will define what the score label will look like.
  // We use a native Text component to do this!
  renderScore = () => (
    <Text
      style={{
        textAlign: 'center',
        fontSize: 64,
        position: 'absolute',
        left: 0,
        right: 0,
        color: 'white',
        top: 64,
        backgroundColor: 'transparent',
      }}>
      {this.state.score}
    </Text>
  );

  render() {
    // This is a dope SpriteView based on SpriteKit that surfaces touches, render, and setup!

    // Call our tap function from the SpriteView
    // Now we will add our score component to the main render method.
    return (
      <View style={StyleSheet.absoluteFill}>
        <SpriteView
          touchDown={({ x, y }) => this.tap()}
          touchMoved={({ x, y }) => {}}
          touchUp={({ x, y }) => {}}
          update={this.updateGame}
          onSetup={this.onSetup}
        />
        {this.renderScore()}
      </View>
    );
  }

}
